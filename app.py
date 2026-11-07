
from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
from pathlib import Path
from datetime import datetime
import uuid

app = Flask(__name__)
CORS(app)

# Database file is stored beside app.py
DATABASE = Path(__file__).with_name("cafeteria.db")


# --------------------------------------------------
# DATABASE CONNECTION
# --------------------------------------------------

def get_db_connection():
    conn = sqlite3.connect(DATABASE, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 20000")
    return conn


def initialize_database():
    conn = get_db_connection()

    try:
        conn.execute("PRAGMA journal_mode = WAL")

        # Create menu table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS menu_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT DEFAULT 'Other',
                price REAL NOT NULL DEFAULT 0,
                stock INTEGER NOT NULL DEFAULT 0,
                is_available INTEGER NOT NULL DEFAULT 1,
                description TEXT DEFAULT ''
            )
        """)

        # Create orders table for a new database
        conn.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                order_number TEXT UNIQUE,
                food TEXT NOT NULL,
                status TEXT DEFAULT 'Waiting',
                price REAL DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Safely migrate an older orders table
        columns = [
            row["name"]
            for row in conn.execute("PRAGMA table_info(orders)").fetchall()
        ]

        if "status" not in columns:
            conn.execute("""
                ALTER TABLE orders
                ADD COLUMN status TEXT DEFAULT 'Waiting'
            """)

        if "price" not in columns:
            conn.execute("""
                ALTER TABLE orders
                ADD COLUMN price REAL DEFAULT 0
            """)

        if "created_at" not in columns:
            # SQLite does not allow CURRENT_TIMESTAMP as an
            # ALTER TABLE column default. Add the column first.
            conn.execute("""
                ALTER TABLE orders
                ADD COLUMN created_at TEXT
            """)

            conn.execute("""
                UPDATE orders
                SET created_at = CURRENT_TIMESTAMP
                WHERE created_at IS NULL
            """)

        if "order_number" not in columns:
            conn.execute("""
                ALTER TABLE orders
                ADD COLUMN order_number TEXT
            """)

        if "food" not in columns:
            conn.execute("""
                ALTER TABLE orders
                ADD COLUMN food TEXT DEFAULT ''
            """)

        if "name" not in columns:
            conn.execute("""
                ALTER TABLE orders
                ADD COLUMN name TEXT DEFAULT 'Customer'
            """)

        # Fill missing values in older records
        conn.execute("""
            UPDATE orders
            SET status = 'Waiting'
            WHERE status IS NULL OR status = ''
        """)

        conn.execute("""
            UPDATE orders
            SET price = 0
            WHERE price IS NULL
        """)

        conn.execute("""
            UPDATE orders
            SET created_at = CURRENT_TIMESTAMP
            WHERE created_at IS NULL OR created_at = ''
        """)

        # Give old orders a tracking number if they do not have one
        old_orders = conn.execute("""
            SELECT id
            FROM orders
            WHERE order_number IS NULL OR order_number = ''
        """).fetchall()

        for order in old_orders:
            token = "CAF" + str(order["id"]).zfill(4)
            conn.execute("""
                UPDATE orders
                SET order_number = ?
                WHERE id = ?
            """, (token, order["id"]))

        # Insert sample menu only when the menu is empty
        menu_count = conn.execute(
            "SELECT COUNT(*) FROM menu_items"
        ).fetchone()[0]

        if menu_count == 0:
            sample_items = [
                ("Idli", "Breakfast", 30, 30, 1, "Soft idli with chutney"),
                ("Dosa", "Breakfast", 40, 25, 1, "Crispy dosa"),
                ("Masala Dosa", "Breakfast", 60, 20, 1, "Dosa with potato masala"),
                ("Poori", "Breakfast", 40, 20, 1, "Poori with curry"),
                ("Veg Meals", "Lunch", 80, 30, 1, "Regular vegetarian meals"),
                ("Fried Rice", "Lunch", 70, 20, 1, "Vegetable fried rice"),
                ("Tea", "Drinks", 10, 50, 1, "Hot tea"),
                ("Coffee", "Drinks", 15, 40, 1, "Hot coffee")
            ]

            conn.executemany("""
                INSERT INTO menu_items
                (name, category, price, stock, is_available, description)
                VALUES (?, ?, ?, ?, ?, ?)
            """, sample_items)

        conn.commit()

    finally:
        conn.close()


# --------------------------------------------------
# HELPER FUNCTIONS
# --------------------------------------------------

def menu_item_to_dict(item):
    data = dict(item)
    data["is_available"] = bool(data["is_available"])
    data["available"] = (
        data["is_available"] and int(data["stock"]) > 0
    )
    return data


def order_to_dict(order, position=None):
    data = dict(order)

    if position is not None:
        data["position"] = position
        data["estimated_wait"] = position * 5

    return data


def create_order_token():
    return "CAF" + uuid.uuid4().hex[:6].upper()


# --------------------------------------------------
# HOME ROUTE
# --------------------------------------------------

@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "message": "Campus Cafeteria Queue Management API is running",
        "status": "success"
    })


# --------------------------------------------------
# MENU ROUTES
# --------------------------------------------------

@app.route("/menu", methods=["GET"])
def get_menu():
    conn = get_db_connection()

    try:
        items = conn.execute("""
            SELECT *
            FROM menu_items
            ORDER BY category, name
        """).fetchall()

        return jsonify([menu_item_to_dict(item) for item in items])

    finally:
        conn.close()


@app.route("/menu", methods=["POST"])
def add_menu_item():
    data = request.get_json(silent=True) or {}

    name = str(data.get("name", data.get("food", ""))).strip()
    category = str(data.get("category", "Other")).strip()
    description = str(data.get("description", "")).strip()

    try:
        price = float(data.get("price", 0))
        stock = int(data.get("stock", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "Enter a valid price and stock quantity"}), 400

    if not name:
        return jsonify({"error": "Food item name is required"}), 400

    if price < 0 or stock < 0:
        return jsonify({"error": "Price and stock cannot be negative"}), 400

    is_available = 1 if data.get("is_available", True) else 0

    conn = get_db_connection()

    try:
        cursor = conn.execute("""
            INSERT INTO menu_items
            (name, category, price, stock, is_available, description)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (name, category, price, stock, is_available, description))

        conn.commit()

        item = conn.execute("""
            SELECT *
            FROM menu_items
            WHERE id = ?
        """, (cursor.lastrowid,)).fetchone()

        return jsonify({
            "message": "Food item added successfully",
            "item": menu_item_to_dict(item)
        }), 201

    finally:
        conn.close()


@app.route("/menu/<int:item_id>", methods=["PUT"])
def update_menu_item(item_id):
    data = request.get_json(silent=True) or {}

    conn = get_db_connection()

    try:
        old_item = conn.execute("""
            SELECT *
            FROM menu_items
            WHERE id = ?
        """, (item_id,)).fetchone()

        if old_item is None:
            return jsonify({"error": "Food item not found"}), 404

        name = str(data.get("name", old_item["name"])).strip()
        category = str(data.get("category", old_item["category"])).strip()
        description = str(
            data.get("description", old_item["description"] or "")
        ).strip()

        try:
            price = float(data.get("price", old_item["price"]))
            stock = int(data.get("stock", old_item["stock"]))
        except (TypeError, ValueError):
            return jsonify({"error": "Enter a valid price and stock quantity"}), 400

        if not name:
            return jsonify({"error": "Food item name is required"}), 400

        if price < 0 or stock < 0:
            return jsonify({"error": "Price and stock cannot be negative"}), 400

        is_available = int(
            data.get("is_available", old_item["is_available"])
        )

        conn.execute("""
            UPDATE menu_items
            SET name = ?,
                category = ?,
                price = ?,
                stock = ?,
                is_available = ?,
                description = ?
            WHERE id = ?
        """, (
            name, category, price, stock,
            is_available, description, item_id
        ))

        conn.commit()

        updated_item = conn.execute("""
            SELECT *
            FROM menu_items
            WHERE id = ?
        """, (item_id,)).fetchone()

        return jsonify({
            "message": "Food item updated successfully",
            "item": menu_item_to_dict(updated_item)
        })

    finally:
        conn.close()


@app.route("/menu/<int:item_id>", methods=["DELETE"])
def delete_menu_item(item_id):
    conn = get_db_connection()

    try:
        item = conn.execute("""
            SELECT id FROM menu_items WHERE id = ?
        """, (item_id,)).fetchone()

        if item is None:
            return jsonify({"error": "Food item not found"}), 404

        conn.execute("""
            DELETE FROM menu_items WHERE id = ?
        """, (item_id,))

        conn.commit()

        return jsonify({"message": "Food item deleted successfully"})

    finally:
        conn.close()


# --------------------------------------------------
# ORDER ROUTES
# --------------------------------------------------

@app.route("/orders", methods=["GET"])
def get_orders():
    conn = get_db_connection()

    try:
        orders = conn.execute("""
            SELECT *
            FROM orders
            WHERE status != 'Completed'
            ORDER BY id ASC
        """).fetchall()

        result = []

        for index, order in enumerate(orders, start=1):
            result.append(order_to_dict(order, index))

        return jsonify(result)

    finally:
        conn.close()


@app.route("/orders", methods=["POST"])
def place_order():
    data = request.get_json(silent=True) or {}

    customer_name = str(data.get("name", "")).strip()

    if not customer_name:
        return jsonify({"error": "Customer name is required"}), 400

    conn = get_db_connection()

    try:
        # New cart format: items = [{id, quantity}, ...]
        cart_items = data.get("items")

        if isinstance(cart_items, list) and cart_items:
            checked_items = []
            total_price = 0
            food_names = []

            # Validate every item before reducing stock
            for cart_item in cart_items:
                try:
                    item_id = int(cart_item.get("id"))
                    quantity = int(cart_item.get("quantity", 1))
                except (TypeError, ValueError, AttributeError):
                    return jsonify({"error": "Invalid cart item"}), 400

                if quantity <= 0:
                    return jsonify({"error": "Quantity must be greater than zero"}), 400

                menu_item = conn.execute("""
                    SELECT *
                    FROM menu_items
                    WHERE id = ?
                """, (item_id,)).fetchone()

                if menu_item is None:
                    return jsonify({"error": "A selected food item no longer exists"}), 400

                if not menu_item["is_available"] or menu_item["stock"] < quantity:
                    return jsonify({
                        "error": menu_item["name"] + " is currently unavailable or has insufficient stock"
                    }), 400

                checked_items.append((menu_item, quantity))
                total_price += float(menu_item["price"]) * quantity
                food_names.append(
                    menu_item["name"] + " x " + str(quantity)
                )

            # Reduce stock after all items pass validation
            for menu_item, quantity in checked_items:
                conn.execute("""
                    UPDATE menu_items
                    SET stock = stock - ?
                    WHERE id = ?
                """, (quantity, menu_item["id"]))

            food_text = ", ".join(food_names)

        else:
            # Legacy format: {name, food, price}
            food_text = str(data.get("food", "")).strip()

            if not food_text:
                return jsonify({"error": "Please select food items"}), 400

            try:
                total_price = float(data.get("price", 0))
            except (TypeError, ValueError):
                return jsonify({"error": "Invalid order price"}), 400

        token = create_order_token()

        cursor = conn.execute("""
            INSERT INTO orders
            (name, order_number, food, status, price, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            customer_name,
            token,
            food_text,
            "Waiting",
            total_price,
            datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ))

        conn.commit()

        order = conn.execute("""
            SELECT *
            FROM orders
            WHERE id = ?
        """, (cursor.lastrowid,)).fetchone()

        return jsonify({
            "message": "Order placed successfully",
            "order": order_to_dict(order),
            "token": token,
            "order_number": token
        }), 201

    except Exception as error:
        conn.rollback()
        return jsonify({"error": str(error)}), 500

    finally:
        conn.close()


@app.route("/orders/<int:order_id>/status", methods=["PATCH"])
def update_order_status(order_id):
    data = request.get_json(silent=True) or {}
    status = str(data.get("status", "")).strip()

    allowed_statuses = [
        "Waiting",
        "Preparing",
        "Ready",
        "Completed"
    ]

    if status not in allowed_statuses:
        return jsonify({"error": "Invalid order status"}), 400

    conn = get_db_connection()

    try:
        order = conn.execute("""
            SELECT id FROM orders WHERE id = ?
        """, (order_id,)).fetchone()

        if order is None:
            return jsonify({"error": "Order not found"}), 404

        conn.execute("""
            UPDATE orders
            SET status = ?
            WHERE id = ?
        """, (status, order_id))

        conn.commit()

        return jsonify({
            "message": "Order status updated successfully",
            "status": status
        })

    finally:
        conn.close()


# Keep compatibility with the earlier frontend's Complete button
@app.route("/orders/<int:order_id>", methods=["DELETE"])
def complete_order(order_id):
    conn = get_db_connection()

    try:
        order = conn.execute("""
            SELECT id FROM orders WHERE id = ?
        """, (order_id,)).fetchone()

        if order is None:
            return jsonify({"error": "Order not found"}), 404

        conn.execute("""
            UPDATE orders
            SET status = 'Completed'
            WHERE id = ?
        """, (order_id,))

        conn.commit()

        return jsonify({"message": "Order completed successfully"})

    finally:
        conn.close()


# --------------------------------------------------
# CUSTOMER ORDER TRACKING
# --------------------------------------------------

@app.route("/track/<token>", methods=["GET"])
def track_order(token):
    conn = get_db_connection()

    try:
        order = conn.execute("""
            SELECT *
            FROM orders
            WHERE order_number = ?
        """, (token.strip(),)).fetchone()

        if order is None:
            return jsonify({"error": "Order not found. Check your token."}), 404

        position = None

        if order["status"] != "Completed":
            position = conn.execute("""
                SELECT COUNT(*)
                FROM orders
                WHERE id <= ?
                AND status != 'Completed'
            """, (order["id"],)).fetchone()[0]

        result = order_to_dict(order, position)

        if order["status"] == "Completed":
            result["estimated_wait"] = 0

        return jsonify(result)

    finally:
        conn.close()


# --------------------------------------------------
# OWNER DASHBOARD SUMMARY
# --------------------------------------------------

@app.route("/summary", methods=["GET"])
def get_summary():
    conn = get_db_connection()

    try:
        total_orders = conn.execute("""
            SELECT COUNT(*) FROM orders
        """).fetchone()[0]

        active_orders = conn.execute("""
            SELECT COUNT(*)
            FROM orders
            WHERE status != 'Completed'
        """).fetchone()[0]

        completed_orders = conn.execute("""
            SELECT COUNT(*)
            FROM orders
            WHERE status = 'Completed'
        """).fetchone()[0]

        total_menu_items = conn.execute("""
            SELECT COUNT(*) FROM menu_items
        """).fetchone()[0]

        unavailable_items = conn.execute("""
            SELECT COUNT(*)
            FROM menu_items
            WHERE is_available = 0 OR stock <= 0
        """).fetchone()[0]

        total_sales = conn.execute("""
            SELECT COALESCE(SUM(price), 0)
            FROM orders
            WHERE status = 'Completed'
        """).fetchone()[0]

        recent_orders = conn.execute("""
            SELECT *
            FROM orders
            ORDER BY id DESC
            LIMIT 10
        """).fetchall()

        return jsonify({
            "total_orders": total_orders,
            "active_orders": active_orders,
            "completed_orders": completed_orders,
            "total_menu_items": total_menu_items,
            "unavailable_items": unavailable_items,
            "total_sales": total_sales,
            "recent_orders": [
                order_to_dict(order)
                for order in recent_orders
            ]
        })

    finally:
        conn.close()


# --------------------------------------------------
# START APPLICATION
# --------------------------------------------------

if __name__ == "__main__":
    initialize_database()
    print("Database initialized successfully.")
    print("Starting Campus Cafeteria Queue Management System...")
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True,
        use_reloader=False
    )
