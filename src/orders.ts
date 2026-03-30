import { Router } from "express"
import pool from "./db"
import { authenticateToken } from "./auth.middleware"

const router = Router()

// ─── ORDERS ──────────────────────────────────────────────────────────────────

// GET ALL ORDERS  (admin only)
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        o.id,
        o.status,
        o.firstname,
        o.lastname,
        o.phone,
        o.email,
        o.wilaya,
        o.commune,
        o.address,
        o.note,
        o.created_at,
        o.updated_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id',         oi.id,
              'product_id', oi.product_id,
              'quantity',   oi.quantity,
              'unit_price', oi.unit_price
            )
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.id
      ORDER BY o.id DESC
    `)

    res.json(result.rows)
  } catch (err) {
    console.error("GET /orders error:", err)
    res.status(500).json({ error: "Failed to fetch orders" })
  }
})

// GET ORDER BY ID  (admin only)
router.get("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params

  try {
    const result = await pool.query(`
      SELECT
        o.id,
        o.status,
        o.firstname,
        o.lastname,
        o.phone,
        o.email,
        o.wilaya,
        o.commune,
        o.address,
        o.note,
        o.created_at,
        o.updated_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id',         oi.id,
              'product_id', oi.product_id,
              'quantity',   oi.quantity,
              'unit_price', oi.unit_price
            )
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.id = $1
      GROUP BY o.id
    `, [id])

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Order not found" })

    res.json(result.rows[0])
  } catch (err) {
    console.error("GET /orders/:id error:", err)
    res.status(500).json({ error: "Failed to fetch order" })
  }
})

// CREATE ORDER  (public — customers place orders)
router.post("/", async (req, res) => {
  const {
    firstname, lastname, phone, email,
    wilaya, commune, address, note,
    items   // Array<{ product_id: number, quantity: number }>
  } = req.body

  // Basic validation
  if (!firstname || !lastname || !phone || !email || !wilaya || !commune || !address)
    return res.status(400).json({ error: "All address fields are required" })

  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: "Order must contain at least one item" })

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Fetch current prices for all requested products in one query
    const productIds = items.map((i: any) => i.product_id)
    const productResult = await client.query(
      `SELECT id, price FROM products WHERE id = ANY($1::int[])`,
      [productIds]
    )

    const priceMap = new Map<number, number>(
      productResult.rows.map(r => [r.id, r.price])
    )

    // Validate every product exists
    for (const item of items) {
      if (!priceMap.has(item.product_id))
        throw new Error(`Product ${item.product_id} not found`)
      if (!Number.isInteger(item.quantity) || item.quantity < 1)
        throw new Error(`Invalid quantity for product ${item.product_id}`)
    }

    // Insert order
    const orderResult = await client.query(
      `INSERT INTO orders (firstname, lastname, phone, email, wilaya, commune, address, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [firstname, lastname, phone, email, wilaya, commune, address, note ?? null]
    )

    const orderId = orderResult.rows[0].id

    // Insert order items — unit_price is snapshotted from current product price
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
         VALUES ($1,$2,$3,$4)`,
        [orderId, item.product_id, item.quantity, priceMap.get(item.product_id)]
      )
    }

    await client.query("COMMIT")
    res.status(201).json({ success: true, id: orderId })
  } catch (err: any) {
    await client.query("ROLLBACK")
    console.error("POST /orders error:", err)
    const userFacing = err.message?.startsWith("Product") || err.message?.startsWith("Invalid")
      ? err.message
      : "Failed to create order"
    res.status(500).json({ error: userFacing })
  } finally {
    client.release()
  }
})

// UPDATE ORDER STATUS  (admin only)
router.patch("/:id/status", authenticateToken, async (req, res) => {
  const { id } = req.params
  const { status } = req.body

  if (!status)
    return res.status(400).json({ error: "Status is required" })

  try {
    const result = await pool.query(
      `UPDATE orders
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, status`,
      [status, id]
    )

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Order not found" })

    res.json(result.rows[0])
  } catch (err) {
    console.error("PATCH /orders/:id/status error:", err)
    res.status(500).json({ error: "Failed to update order status" })
  }
})

// DELETE ORDER  (admin only)
router.delete("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params

  try {
    const result = await pool.query(
      `DELETE FROM orders WHERE id = $1 RETURNING id`,
      [id]
    )
    // order_items cascade-delete automatically

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Order not found" })

    res.json({ success: true })
  } catch (err) {
    console.error("DELETE /orders/:id error:", err)
    res.status(500).json({ error: "Failed to delete order" })
  }
})

export default router