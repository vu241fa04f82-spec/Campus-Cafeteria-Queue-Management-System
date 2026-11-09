
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Utensils, Plus, Search, ShoppingCart, LayoutDashboard,
  ClipboardList, CheckCircle2, Clock3, Package, Trash2,
  Pencil, RefreshCw, X, Bell
} from "lucide-react";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "/api";

const money = (value) => `₹${Number(value || 0).toFixed(2)}`;

const isItemAvailable = (item) =>
  Boolean(item.available ?? item.is_available) &&
  Number(item.stock ?? 0) > 0;

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json")
    ? await response.json()
    : {};

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  return data;
}

const emptyForm = {
  name: "",
  category: "Breakfast",
  description: "",
  price: "",
  stock: "10",
  image_url: ""
};

const foodEmojis = {
  Breakfast: "🥞",
  Lunch: "🍛",
  Snacks: "🍟",
  Drinks: "🥤",
  Desserts: "🍰",
  Other: "🍽️"
};

export default function App() {
  const [menu, setMenu] = useState([]);
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState({});
  const [tab, setTab] = useState("menu");

  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");

  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState("");

  const [token, setToken] = useState("");
  const [tracked, setTracked] = useState(null);

  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);

    try {
      const [menuData, orderData, summaryData] = await Promise.all([
        api("/menu"),
        api("/orders"),
        api("/summary")
      ]);

      setMenu(Array.isArray(menuData) ? menuData : []);
      setOrders(Array.isArray(orderData) ? orderData : []);
      setSummary(summaryData || {});
      setError("");
    } catch (err) {
      setError(
        `${err.message} Make sure the Flask backend is running.`
      );
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll(true);
    const timer = setInterval(() => loadAll(false), 5000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const categories = useMemo(() => [
    "All",
    ...new Set(menu.map(item => item.category || "Other"))
  ], [menu]);

  const visibleMenu = useMemo(() => {
    return menu.filter(item => {
      const categoryMatch =
        category === "All" || item.category === category;

      const searchMatch =
        String(item.name || "")
          .toLowerCase()
          .includes(search.toLowerCase());

      return categoryMatch && searchMatch;
    });
  }, [menu, category, search]);

  const cartTotal = cart.reduce(
    (sum, item) => sum + Number(item.price) * item.quantity,
    0
  );

  const cartCount = cart.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  function addToCart(item) {
    if (!isItemAvailable(item)) {
      setError("Sorry, this food item is currently unavailable.");
      return;
    }

    const existing = cart.find(line => line.id === item.id);

    if (existing && existing.quantity >= Number(item.stock)) {
      setError(`Only ${item.stock} portions of ${item.name} are available.`);
      return;
    }

    setCart(old => {
      const found = old.find(line => line.id === item.id);

      if (found) {
        return old.map(line =>
          line.id === item.id
            ? { ...line, quantity: line.quantity + 1 }
            : line
        );
      }

      return [
        ...old,
        {
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
          stock: Number(item.stock)
        }
      ];
    });

    setNotice(`${item.name} added to your cart.`);
    setError("");
  }

  function changeQuantity(id, difference) {
    setCart(old =>
      old.map(item => {
        if (item.id !== id) return item;

        return {
          ...item,
          quantity: Math.max(
            1,
            Math.min(item.stock, item.quantity + difference)
          )
        };
      })
    );
  }

  async function placeOrder(event) {
    event.preventDefault();

    if (busy) return;

    setError("");
    setNotice("");

    if (!customerName.trim()) {
      setError("Enter your name before placing the order.");
      return;
    }

    if (!cart.length) {
      setError("Your cart is empty.");
      return;
    }

    setBusy(true);

    try {
      const result = await api("/orders", {
        method: "POST",
        body: JSON.stringify({
          name: customerName.trim(),
          items: cart.map(item => ({
            id: item.id,
            quantity: item.quantity
          }))
        })
      });

      setToken(String(result.order_number ?? ""));
      setTracked(result);
      setCart([]);
      setCustomerName("");

      setNotice(
        `Order placed successfully! Your token number is ${result.order_number}.`
      );

      await loadAll();
      setTab("track");
    } catch (err) {
      setError(err.message);
      await loadAll();
    } finally {
      setBusy(false);
    }
  }

  async function trackOrder(event) {
    if (event) event.preventDefault();

    setError("");
    setNotice("");

    if (!token.trim()) {
      setError("Enter your token number.");
      return;
    }

    try {
      const result = await api(
        `/track/${encodeURIComponent(token.trim())}`
      );
      setTracked(result);
    } catch (err) {
      setTracked(null);
      setError(err.message);
    }
  }

  function startEdit(item) {
    setEditingId(item.id);

    setForm({
      name: item.name || "",
      category: item.category || "Breakfast",
      description: item.description || "",
      price: String(item.price ?? ""),
      stock: String(item.stock ?? 0),
      image_url: item.image_url || ""
    });

    setShowForm(true);
    setTab("manage");
  }

  async function saveItem(event) {
    event.preventDefault();

    if (busy) return;

    setError("");
    setNotice("");

    if (!form.name.trim() || form.price === "" || form.stock === "") {
      setError("Enter food name, price and stock.");
      return;
    }

    const price = Number(form.price);
    const stock = Number(form.stock);

    if (
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isInteger(stock) ||
      stock < 0
    ) {
      setError("Enter a valid price and whole-number stock.");
      return;
    }

    setBusy(true);

    try {
      await api(
        editingId ? `/menu/${editingId}` : "/menu",
        {
          method: editingId ? "PUT" : "POST",
          body: JSON.stringify({
            ...form,
            name: form.name.trim(),
            price,
            stock,
            is_available: stock > 0
          })
        }
      );

      setNotice(
        editingId
          ? "Food item updated successfully."
          : "New food item added. Customers can now see it."
      );

      setForm(emptyForm);
      setEditingId(null);
      setShowForm(false);

      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAvailability(item) {
    try {
      const currentlyAvailable = isItemAvailable(item);

      await api(`/menu/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...item,
          is_available: !currentlyAvailable
        })
      });

      setNotice(`${item.name} availability updated.`);
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteItem(item) {
    if (!window.confirm(`Delete ${item.name} from the menu?`)) return;

    try {
      await api(`/menu/${item.id}`, { method: "DELETE" });

      setCart(old => old.filter(line => line.id !== item.id));
      setNotice(`${item.name} deleted from the menu.`);
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateStatus(order, status) {
    try {
      await api(`/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });

      setNotice(`Token ${order.order_number} updated to ${status}.`);

      await loadAll();

      if (String(token) === String(order.order_number)) {
        const result = await api(
          `/track/${encodeURIComponent(order.order_number)}`
        );
        setTracked(result);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon"><Utensils /></span>
          <div>
            <b>Campus Cafeteria</b>
            <small>Smart food and queue management</small>
          </div>
        </div>

        <div className="live">
          <span />
          Live updates every 5 seconds
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">WELCOME TO YOUR CAMPUS FOOD HUB</p>
          <h1>Good food. Less waiting.</h1>
          <p>
            Explore today's menu, check availability
            and place your order online.
          </p>
        </div>

        <div className="hero-art" aria-hidden="true">
          <span>🍔</span>
          <span>🥤</span>
          <span>🍕</span>
        </div>
      </section>

      <nav className="tabs">
        <button className={tab === "menu" ? "active" : ""} onClick={() => setTab("menu")}>
          <Utensils size={17} /> Food Menu
        </button>

        <button className={tab === "cart" ? "active" : ""} onClick={() => setTab("cart")}>
          <ShoppingCart size={17} /> Cart <em>{cartCount}</em>
        </button>

        <button className={tab === "track" ? "active" : ""} onClick={() => setTab("track")}>
          <Bell size={17} /> Track Order
        </button>

        <button className={tab === "manage" ? "active" : ""} onClick={() => setTab("manage")}>
          <Package size={17} /> Owner: Menu
        </button>

        <button className={tab === "dashboard" ? "active" : ""} onClick={() => setTab("dashboard")}>
          <LayoutDashboard size={17} /> Dashboard
        </button>
      </nav>

      {(notice || error) && (
        <div className={error ? "alert error" : "alert success"} role="status">
          {error || notice}
          <button
            type="button"
            aria-label="Close notification"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {tab === "menu" && (
        <main className="content">
          <div className="section-heading">
            <div>
              <p className="eyebrow">FRESHLY PREPARED</p>
              <h2>Today's Food Menu</h2>
              <p>Only available items can be added to your cart.</p>
            </div>

            <button className="soft-button" onClick={() => loadAll(true)}>
              <RefreshCw size={16} /> Refresh menu
            </button>
          </div>

          <div className="toolbar">
            <div className="searchbox">
              <Search size={18} />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search food items..."
              />
            </div>

            <div className="categories">
              {categories.map(item => (
                <button
                  key={item}
                  className={category === item ? "selected" : ""}
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="empty"><RefreshCw /> Loading food menu...</div>
          ) : (
            <div className="food-grid">
              {visibleMenu.map(item => {
                const available = isItemAvailable(item);

                return (
                  <article className="food-card" key={item.id}>
                    <div className="food-picture">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          onError={event => {
                            event.currentTarget.style.display = "none";
                            const fallback = event.currentTarget.nextElementSibling;
                            if (fallback) fallback.style.display = "grid";
                          }}
                        />
                      ) : null}

                      <span
                        className="food-fallback"
                        style={{ display: item.image_url ? "none" : "grid" }}
                      >
                        {foodEmojis[item.category] || "🍽️"}
                      </span>

                      <label className={available ? "stock available" : "stock unavailable"}>
                        {available ? "Available" : "Out of stock"}
                      </label>
                    </div>

                    <div className="food-info">
                      <small>{item.category || "Other"}</small>
                      <h3>{item.name}</h3>
                      <p>
                        {item.description || "Freshly prepared at our cafeteria."}
                      </p>

                      <div className="food-bottom">
                        <b>{money(item.price)}</b>
                        <button
                          disabled={!available}
                          onClick={() => addToCart(item)}
                        >
                          <Plus size={16} /> Add
                        </button>
                      </div>

                      <small className="stock-count">
                        {available
                          ? `${item.stock} portions left`
                          : "Please choose another item"}
                      </small>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {!loading && !visibleMenu.length && (
            <div className="empty">
              <Utensils />
              <h3>No food items found</h3>
              <p>Try another search or category.</p>
            </div>
          )}
        </main>
      )}

      {tab === "cart" && (
        <main className="content narrow">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR SELECTION</p>
              <h2>Your Cart</h2>
              <p>Check your items before placing the order.</p>
            </div>
          </div>

          {!cart.length ? (
            <div className="empty">
              <ShoppingCart />
              <h3>Your cart is empty</h3>
              <button onClick={() => setTab("menu")}>Browse food menu</button>
            </div>
          ) : (
            <>
              <div className="cart-list">
                {cart.map(item => (
                  <div className="cart-line" key={item.id}>
                    <div>
                      <b>{item.name}</b>
                      <small>{money(item.price)} each</small>
                    </div>

                    <div className="quantity">
                      <button onClick={() => changeQuantity(item.id, -1)}>−</button>
                      <b>{item.quantity}</b>
                      <button
                        disabled={item.quantity >= item.stock}
                        onClick={() => changeQuantity(item.id, 1)}
                      >
                        +
                      </button>
                    </div>

                    <strong>{money(item.price * item.quantity)}</strong>

                    <button
                      className="icon-button danger"
                      onClick={() => setCart(old => old.filter(line => line.id !== item.id))}
                      aria-label={`Remove ${item.name}`}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
              </div>

              <form className="checkout" onSubmit={placeOrder}>
                <label>
                  Your name
                  <input
                    value={customerName}
                    onChange={event => setCustomerName(event.target.value)}
                    placeholder="Enter your name"
                    required
                  />
                </label>

                <div className="total">
                  <span>Total amount</span>
                  <b>{money(cartTotal)}</b>
                </div>

                <button className="primary full" disabled={busy}>
                  {busy ? "Placing order..." : "Place Order"}
                </button>
              </form>
            </>
          )}
        </main>
      )}

      {tab === "track" && (
        <main className="content narrow">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ORDER PROGRESS</p>
              <h2>Track Your Order</h2>
              <p>Enter your token number to check your order.</p>
            </div>
          </div>

          <form className="track-form" onSubmit={trackOrder}>
            <input
              value={token}
              onChange={event => setToken(event.target.value)}
              placeholder="Enter token number"
            />
            <button className="primary">Track</button>
          </form>

          {tracked && (
            <div className="track-result">
              <div className="token-circle">#{tracked.order_number}</div>
              <h3>{tracked.name}'s order</h3>
              <p>{tracked.food}</p>
              <b className="track-price">{money(tracked.price)}</b>
              <div className="status-pill">{tracked.status}</div>

              {tracked.status === "Completed" ? (
                <p className="ready-note">
                  Your order has been completed. Enjoy your meal!
                </p>
              ) : (
                <div className="queue-details">
                  <div>
                    <small>Queue position</small>
                    <b>{tracked.position ?? "—"}</b>
                  </div>
                  <div>
                    <small>Estimated wait</small>
                    <b>{tracked.estimated_minutes ?? 0} min</b>
                  </div>
                </div>
              )}

              <button type="button" className="soft-button" onClick={() => trackOrder()}>
                Refresh status
              </button>
            </div>
          )}
        </main>
      )}

      {tab === "manage" && (
        <main className="content">
          <div className="section-heading">
            <div>
              <p className="eyebrow">OWNER CONTROLS</p>
              <h2>Manage Food Menu</h2>
              <p>
                Add new food or update price, stock and availability.
                Customers see changes automatically.
              </p>
            </div>

            <button
              className="primary"
              onClick={() => {
                setForm(emptyForm);
                setEditingId(null);
                setShowForm(!showForm);
              }}
            >
              <Plus size={17} /> Add food item
            </button>
          </div>

          {showForm && (
            <form className="item-form" onSubmit={saveItem}>
              <h3>{editingId ? "Edit food item" : "Add a new food item"}</h3>

              <div className="form-grid">
                <label>
                  Food name
                  <input
                    value={form.name}
                    onChange={event => setForm({ ...form, name: event.target.value })}
                    placeholder="e.g. Paneer roll"
                    required
                  />
                </label>

                <label>
                  Category
                  <select
                    value={form.category}
                    onChange={event => setForm({ ...form, category: event.target.value })}
                  >
                    {["Breakfast", "Lunch", "Snacks", "Drinks", "Desserts", "Other"].map(item => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Price (₹)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={event => setForm({ ...form, price: event.target.value })}
                    required
                  />
                </label>

                <label>
                  Available quantity
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.stock}
                    onChange={event => setForm({ ...form, stock: event.target.value })}
                    required
                  />
                </label>

                <label className="wide">
                  Description
                  <input
                    value={form.description}
                    onChange={event => setForm({ ...form, description: event.target.value })}
                    placeholder="Short description"
                  />
                </label>

                <label className="wide">
                  Image URL (optional)
                  <input
                    type="url"
                    value={form.image_url}
                    onChange={event => setForm({ ...form, image_url: event.target.value })}
                    placeholder="https://..."
                  />
                </label>
              </div>

              <div className="form-actions">
                <button className="primary" disabled={busy}>
                  {busy ? "Saving..." : editingId ? "Save changes" : "Add to menu"}
                </button>

                <button
                  type="button"
                  className="soft-button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                    setForm(emptyForm);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="manage-list">
            {menu.map(item => {
              const available = isItemAvailable(item);

              return (
                <div className="manage-row" key={item.id}>
                  <div className="manage-emoji">
                    {foodEmojis[item.category] || "🍴"}
                  </div>

                  <div className="manage-details">
                    <b>{item.name}</b>
                    <small>
                      {item.category} · {money(item.price)} · Stock: {item.stock}
                    </small>
                    <span className={available ? "text-green" : "text-red"}>
                      {available ? "Available to customers" : "Shown as out of stock to customers"}
                    </span>
                  </div>

                  <button className="soft-button small" onClick={() => startEdit(item)}>
                    <Pencil size={15} /> Edit
                  </button>

                  <button className="soft-button small" onClick={() => toggleAvailability(item)}>
                    {available ? "Mark unavailable" : "Mark available"}
                  </button>

                  <button
                    className="icon-button danger"
                    onClick={() => deleteItem(item)}
                    aria-label={`Delete ${item.name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}

            {!menu.length && <p className="muted">No food items added yet.</p>}
          </div>
        </main>
      )}

      {tab === "dashboard" && (
        <main className="content">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CAFETERIA OVERVIEW</p>
              <h2>Owner Dashboard</h2>
              <p>Monitor orders, queue and order values.</p>
            </div>

            <button className="soft-button" onClick={() => loadAll(true)}>
              <RefreshCw size={16} /> Refresh
            </button>
          </div>

          <div className="stats-grid">
            <Stat icon={<ClipboardList />} label="Total orders" value={summary.total_orders ?? 0} />
            <Stat icon={<Clock3 />} label="Active orders" value={summary.active_orders ?? 0} />
            <Stat icon={<CheckCircle2 />} label="Completed orders" value={summary.completed_orders ?? 0} />
            <Stat icon={<Package />} label="Menu items" value={menu.length} />
            <Stat icon={<ShoppingCart />} label="Total order value" value={money(summary.total_order_value)} />
            <Stat icon={<CheckCircle2 />} label="Completed order value" value={money(summary.completed_order_value)} />
          </div>

          <div className="panel">
            <h3>Active Queue</h3>

            {orders.length ? orders.map(order => (
              <div className="queue-row" key={order.id}>
                <div>
                  <b>Token #{order.order_number} · {order.name}</b>
                  <small>
                    {order.food} · {money(order.price)} · Position {order.position ?? "—"}
                  </small>
                </div>

                <select
                  value={order.status}
                  onChange={event => updateStatus(order, event.target.value)}
                >
                  {["Waiting", "Preparing", "Ready", "Completed"].map(status => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </div>
            )) : (
              <p className="muted">No active orders.</p>
            )}
          </div>

          <div className="panel">
            <h3>Recent Orders</h3>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Customer</th>
                    <th>Food</th>
                    <th>Price</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {(summary.recent_orders || []).map(order => (
                    <tr key={order.id}>
                      <td>#{order.order_number}</td>
                      <td>{order.name}</td>
                      <td>{order.food}</td>
                      <td>{money(order.price)}</td>
                      <td>{order.status}</td>
                    </tr>
                  ))}

                  {!summary.recent_orders?.length && (
                    <tr><td colSpan="5">No orders yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      )}

      <footer>
        Campus Cafeteria Queue Management System · Fresh food, smarter service
      </footer>
    </div>
  );
}

function Stat({ icon, label, value }) {
  return (
    <div className="stat-card">
      <span>{icon}</span>
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}
