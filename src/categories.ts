import { Router } from "express"
import pool from "./db"
import { authenticateToken } from "./auth.middleware"

const router = Router()

// GET ALL CATEGORIES
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name
      FROM categories
      ORDER BY name
    `)

    res.json(result.rows)
  } catch (err) {
    console.error("GET /categories error:", err)
    res.status(500).json({ error: "Failed to fetch categories" })
  }
})

// GET CATEGORY BY ID
router.get("/:id", async (req, res) => {
  const { id } = req.params

  try {
    const result = await pool.query(
      `SELECT id, name FROM categories WHERE id = $1`,
      [id]
    )

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Category not found" })

    res.json(result.rows[0])
  } catch (err) {
    console.error("GET /categories/:id error:", err)
    res.status(500).json({ error: "Failed to fetch category" })
  }
})

// CREATE CATEGORY
router.post("/", authenticateToken, async (req, res) => {
  const { name } = req.body

  if (!name)
    return res.status(400).json({ error: "Category name is required" })

  try {
    const result = await pool.query(
      `INSERT INTO categories (name) VALUES ($1) RETURNING id, name`,
      [name]
    )

    res.status(201).json(result.rows[0])
  } catch (err: any) {
    if (err.code === "23505")
      return res.status(409).json({ error: "Category already exists" })
    console.error("POST /categories error:", err)
    res.status(500).json({ error: "Failed to create category" })
  }
})

// UPDATE CATEGORY
router.put("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params
  const { name } = req.body

  if (!name)
    return res.status(400).json({ error: "Category name is required" })

  try {
    const result = await pool.query(
      `UPDATE categories SET name = $1 WHERE id = $2 RETURNING id, name`,
      [name, id]
    )

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Category not found" })

    res.json(result.rows[0])
  } catch (err: any) {
    if (err.code === "23505")
      return res.status(409).json({ error: "Category name already exists" })
    console.error("PUT /categories/:id error:", err)
    res.status(500).json({ error: "Failed to update category" })
  }
})

// DELETE CATEGORY
router.delete("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params

  try {
    const result = await pool.query(
      `DELETE FROM categories WHERE id = $1 RETURNING id`,
      [id]
    )

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Category not found" })

    // Products with this category_id become NULL (ON DELETE SET NULL)
    res.json({ success: true })
  } catch (err) {
    console.error("DELETE /categories/:id error:", err)
    res.status(500).json({ error: "Failed to delete category" })
  }
})

export default router