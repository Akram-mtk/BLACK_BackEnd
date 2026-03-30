import { Router } from "express"
import pool from "./db"
import { upload } from "./multer.config"
import fs from "fs/promises"
import path from "path"
import { authenticateToken } from "./auth.middleware"

const router = Router()

// Safe helper: build full image URL without SQL interpolation
function toUrl(filename: string | null): string | null {
  if (!filename) return null
  return `${process.env.BASE_IMAGE_URL}${filename}`
}

// Safe helper: delete a file from disk (non-throwing)
async function deleteFile(filename: string): Promise<void> {
  try {
    const filePath = path.join("uploads", path.basename(filename))
    await fs.unlink(filePath)
  } catch {
    // File missing or already deleted — not a fatal error
  }
}

// CREATE PRODUCT
router.post(
  "/",
  authenticateToken,
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "images", maxCount: 10 }
  ]),
  async (req, res) => {
    const { name, description, price, category } = req.body

    const files = req.files as {
      thumbnail?: Express.Multer.File[]
      images?: Express.Multer.File[]
    }

    const thumbnail = files.thumbnail?.[0]?.filename ?? null
    const images = files.images ?? []

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      const product = await client.query(
        `INSERT INTO products (name, description, price, category, thumbnail)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id`,
        [name, description, price, category, thumbnail]
      )

      const productId = product.rows[0].id

      for (const file of images) {
        await client.query(
          `INSERT INTO product_images (product_id, image_url)
           VALUES ($1,$2)`,
          [productId, file.filename]
        )
      }

      await client.query("COMMIT")
      res.json({ success: true, id: productId })
    } catch (err) {
      await client.query("ROLLBACK")
      // Clean up uploaded files if DB insert failed
      if (thumbnail) await deleteFile(thumbnail)
      for (const file of images) await deleteFile(file.filename)
      console.error("POST /products error:", err)
      res.status(500).json({ error: "Failed to create product" })
    } finally {
      client.release()
    }
  }
)

// GET ALL PRODUCTS
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.description,
        p.price,
        p.category,
        p.thumbnail,
        COALESCE(
          json_agg(pi.image_url) FILTER (WHERE pi.id IS NOT NULL),
          '[]'
        ) AS images
      FROM products p
      LEFT JOIN product_images pi ON p.id = pi.product_id
      GROUP BY p.id
      ORDER BY p.id DESC
    `)

    const rows = result.rows.map(r => ({
      ...r,
      thumbnail: toUrl(r.thumbnail),
      images: (r.images as string[]).map(toUrl)
    }))

    res.json(rows)
  } catch (err) {
    console.error("GET /products error:", err)
    res.status(500).json({ error: "Failed to fetch products" })
  }
})

// GET CATEGORIES
router.get("/categories", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT category
      FROM products
      WHERE category IS NOT NULL
      ORDER BY category
    `)

    res.json(result.rows.map(r => r.category))
  } catch (err) {
    console.error("GET /products/categories error:", err)
    res.status(500).json({ error: "Failed to fetch categories" })
  }
})

// GET PRODUCT BY ID
router.get("/id/:id", async (req, res) => {
  const { id } = req.params

  try {
    const result = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.description,
        p.price,
        p.category,
        p.thumbnail,
        COALESCE(
          json_agg(pi.image_url) FILTER (WHERE pi.id IS NOT NULL),
          '[]'
        ) AS images
      FROM products p
      LEFT JOIN product_images pi ON p.id = pi.product_id
      WHERE p.id = $1
      GROUP BY p.id
    `, [id])

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Product not found" })

    const row = result.rows[0]
    res.json({
      ...row,
      thumbnail: toUrl(row.thumbnail),
      images: (row.images as string[]).map(toUrl)
    })
  } catch (err) {
    console.error("GET /products/id/:id error:", err)
    res.status(500).json({ error: "Failed to fetch product" })
  }
})

// GET PRODUCTS BY CATEGORY
router.get("/category/:category", async (req, res) => {
  const { category } = req.params

  try {
    const result = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.description,
        p.price,
        p.category,
        p.thumbnail,
        COALESCE(
          json_agg(pi.image_url) FILTER (WHERE pi.id IS NOT NULL),
          '[]'
        ) AS images
      FROM products p
      LEFT JOIN product_images pi ON p.id = pi.product_id
      WHERE p.category = $1
      GROUP BY p.id
      ORDER BY p.id DESC
    `, [category])

    const rows = result.rows.map(r => ({
      ...r,
      thumbnail: toUrl(r.thumbnail),
      images: (r.images as string[]).map(toUrl)
    }))

    res.json(rows)
  } catch (err) {
    console.error("GET /products/category/:category error:", err)
    res.status(500).json({ error: "Failed to fetch products" })
  }
})

// UPDATE PRODUCT
router.put(
  "/:id",
  authenticateToken,
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "images", maxCount: 10 }
  ]),
  async (req, res) => {
    const { id } = req.params
    const { name, description, price, category } = req.body

    const files = req.files as {
      thumbnail?: Express.Multer.File[]
      images?: Express.Multer.File[]
    }

    const newThumbnail = files.thumbnail?.[0]?.filename ?? null
    const newImages = files.images ?? []

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      // Fetch old thumbnail before overwriting
      const existing = await client.query(
        `SELECT thumbnail FROM products WHERE id = $1`,
        [id]
      )

      if (existing.rows.length === 0) {
        await client.query("ROLLBACK")
        if (newThumbnail) await deleteFile(newThumbnail)
        for (const f of newImages) await deleteFile(f.filename)
        return res.status(404).json({ error: "Product not found" })
      }

      const oldThumbnail = existing.rows[0].thumbnail

      await client.query(
        `UPDATE products
         SET name=$1, description=$2, price=$3, category=$4,
             thumbnail = COALESCE($5, thumbnail)
         WHERE id=$6`,
        [name, description, price, category, newThumbnail, id]
      )

      for (const file of newImages) {
        await client.query(
          `INSERT INTO product_images (product_id, image_url)
           VALUES ($1,$2)`,
          [id, file.filename]
        )
      }

      await client.query("COMMIT")

      // Delete old thumbnail from disk only after successful DB update
      if (newThumbnail && oldThumbnail) await deleteFile(oldThumbnail)

      res.json({ success: true })
    } catch (err) {
      await client.query("ROLLBACK")
      if (newThumbnail) await deleteFile(newThumbnail)
      for (const f of newImages) await deleteFile(f.filename)
      console.error("PUT /products/:id error:", err)
      res.status(500).json({ error: "Failed to update product" })
    } finally {
      client.release()
    }
  }
)

// DELETE PRODUCT
router.delete("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const product = await client.query(
      `SELECT thumbnail FROM products WHERE id = $1`,
      [id]
    )

    if (product.rows.length === 0) {
      await client.query("ROLLBACK")
      return res.status(404).json({ error: "Product not found" })
    }

    const images = await client.query(
      `SELECT image_url FROM product_images WHERE product_id = $1`,
      [id]
    )

    await client.query(`DELETE FROM products WHERE id = $1`, [id])

    await client.query("COMMIT")

    // Delete files only after successful DB delete
    if (product.rows[0]?.thumbnail) await deleteFile(product.rows[0].thumbnail)
    for (const img of images.rows) await deleteFile(img.image_url)

    res.json({ success: true })
  } catch (err) {
    await client.query("ROLLBACK")
    console.error("DELETE /products/:id error:", err)
    res.status(500).json({ error: "Failed to delete product" })
  } finally {
    client.release()
  }
})

// ADD EXTRA IMAGES
router.post(
  "/:id/images",
  authenticateToken,
  upload.array("images", 10),
  async (req, res) => {
    const { id } = req.params
    const files = req.files as Express.Multer.File[]

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      // Verify product exists before inserting images
      const exists = await client.query(
        `SELECT id FROM products WHERE id = $1`,
        [id]
      )

      if (exists.rows.length === 0) {
        await client.query("ROLLBACK")
        for (const f of files) await deleteFile(f.filename)
        return res.status(404).json({ error: "Product not found" })
      }

      for (const file of files) {
        await client.query(
          `INSERT INTO product_images (product_id, image_url)
           VALUES ($1,$2)`,
          [id, file.filename]
        )
      }

      await client.query("COMMIT")
      res.json({ success: true })
    } catch (err) {
      await client.query("ROLLBACK")
      for (const f of files) await deleteFile(f.filename)
      console.error("POST /products/:id/images error:", err)
      res.status(500).json({ error: "Failed to add images" })
    } finally {
      client.release()
    }
  }
)

// DELETE IMAGE
router.delete("/images/:id", authenticateToken, async (req, res) => {
  const { id } = req.params

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const result = await client.query(
      `SELECT image_url FROM product_images WHERE id = $1`,
      [id]
    )

    if (result.rows.length === 0) {
      await client.query("ROLLBACK")
      return res.status(404).json({ error: "Image not found" })
    }

    await client.query(`DELETE FROM product_images WHERE id = $1`, [id])

    await client.query("COMMIT")

    // Delete file only after successful DB delete
    await deleteFile(result.rows[0].image_url)

    res.json({ success: true })
  } catch (err) {
    await client.query("ROLLBACK")
    console.error("DELETE /products/images/:id error:", err)
    res.status(500).json({ error: "Failed to delete image" })
  } finally {
    client.release()
  }
})

export default router