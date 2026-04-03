import { Router } from "express"
import pool from "./db"
import { upload } from "./multer.config"
import { uploadFile, deleteFile } from "./storage"
import { authenticateToken } from "./auth.middleware"

const router = Router()

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function toUrl(key: string | null): string | null {
  if (!key) return null
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET}/${key}`
}

const PRODUCT_SELECT = `
  SELECT
    p.id,
    p.name,
    p.description,
    p.price,
    p.category_id,
    c.name   AS category,
    p.thumbnail,
    p.created_at,
    p.updated_at,
    COALESCE(
      json_agg(pi.image_url) FILTER (WHERE pi.id IS NOT NULL),
      '[]'
    ) AS images
  FROM products p
  LEFT JOIN categories c  ON p.category_id = c.id
  LEFT JOIN product_images pi ON p.id = pi.product_id
`

function mapRow(r: any) {
  return {
    ...r,
    thumbnail: toUrl(r.thumbnail),
    images: (r.images as string[]).map(toUrl),
  }
}

// Upload a batch of multer files, returns their keys.
// Cleans up any successful uploads if one fails mid-batch.
async function uploadAll(files: Express.Multer.File[]): Promise<string[]> {
  const keys: string[] = []
  try {
    for (const f of files)
      keys.push(await uploadFile(f.buffer, f.originalname, f.mimetype))
  } catch (err) {
    for (const k of keys) await deleteFile(k)
    throw err
  }
  return keys
}

// ─── CREATE PRODUCT ───────────────────────────────────────────────────────────
router.post(
  "/",
  authenticateToken,
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  async (req, res) => {
    const { name, description, price, category_id } = req.body

    if (!name || price === undefined)
      return res.status(400).json({ error: "name and price are required" })

    const files = req.files as {
      thumbnail?: Express.Multer.File[]
      images?: Express.Multer.File[]
    }

    // Upload to Supabase before touching the DB
    let thumbnailKey: string | null = null
    let imageKeys: string[] = []

    try {
      if (files.thumbnail?.[0])
        thumbnailKey = (await uploadAll([files.thumbnail[0]]))[0]
      if (files.images?.length)
        imageKeys = await uploadAll(files.images)
    } catch (err) {
      console.error("POST /products upload error:", err)
      return res.status(500).json({ error: "Failed to upload images" })
    }

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      const product = await client.query(
        `INSERT INTO products (name, description, price, category_id, thumbnail)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id`,
        [name, description ?? null, price, category_id ?? null, thumbnailKey]
      )

      const productId = product.rows[0].id

      for (const key of imageKeys) {
        await client.query(
          `INSERT INTO product_images (product_id, image_url) VALUES ($1,$2)`,
          [productId, key]
        )
      }

      await client.query("COMMIT")
      res.status(201).json({ success: true, id: productId })
    } catch (err) {
      await client.query("ROLLBACK")
      // DB failed — remove the files we just uploaded
      if (thumbnailKey) await deleteFile(thumbnailKey)
      for (const k of imageKeys) await deleteFile(k)
      console.error("POST /products DB error:", err)
      res.status(500).json({ error: "Failed to create product" })
    } finally {
      client.release()
    }
  }
)

// ─── GET ALL PRODUCTS ─────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      ${PRODUCT_SELECT}
      GROUP BY p.id, c.id
      ORDER BY p.id DESC
    `)

    res.json(result.rows.map(mapRow))
  } catch (err) {
    console.error("GET /products error:", err)
    res.status(500).json({ error: "Failed to fetch products" })
  }
})

// ─── GET PRODUCTS BY CATEGORY ─────────────────────────────────────────────────
router.get("/category/:categoryId", async (req, res) => {
  const { categoryId } = req.params

  try {
    const result = await pool.query(`
      ${PRODUCT_SELECT}
      WHERE p.category_id = $1
      GROUP BY p.id, c.id
      ORDER BY p.id DESC
    `, [categoryId])

    res.json(result.rows.map(mapRow))
  } catch (err) {
    console.error("GET /products/category/:categoryId error:", err)
    res.status(500).json({ error: "Failed to fetch products" })
  }
})

// ─── GET PRODUCT BY ID ────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { id } = req.params

  try {
    const result = await pool.query(`
      ${PRODUCT_SELECT}
      WHERE p.id = $1
      GROUP BY p.id, c.id
    `, [id])

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Product not found" })

    res.json(mapRow(result.rows[0]))
  } catch (err) {
    console.error("GET /products/:id error:", err)
    res.status(500).json({ error: "Failed to fetch product" })
  }
})

// ─── UPDATE PRODUCT (partial) ─────────────────────────────────────────────────
// Only the fields you send will be updated. Omitted fields keep their current value.
// To clear category_id, send category_id: null explicitly.
router.patch(
  "/:id",
  authenticateToken,
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  async (req, res) => {
    const { id } = req.params
    const { name, description, price, category_id } = req.body

    const files = req.files as {
      thumbnail?: Express.Multer.File[]
      images?: Express.Multer.File[]
    }

    // Upload new files to Supabase before touching the DB
    let newThumbnailKey: string | null = null
    let newImageKeys: string[] = []

    try {
      if (files.thumbnail?.[0])
        newThumbnailKey = (await uploadAll([files.thumbnail[0]]))[0]
      if (files.images?.length)
        newImageKeys = await uploadAll(files.images)
    } catch (err) {
      console.error("PATCH /products/:id upload error:", err)
      return res.status(500).json({ error: "Failed to upload images" })
    }

    // Build SET clause dynamically from only the provided fields
    const setClauses: string[] = []
    const values: any[] = []

    if (name !== undefined) {
      values.push(name)
      setClauses.push(`name = $${values.length}`)
    }
    if (description !== undefined) {
      values.push(description)
      setClauses.push(`description = $${values.length}`)
    }
    if (price !== undefined) {
      values.push(price)
      setClauses.push(`price = $${values.length}`)
    }
    if (category_id !== undefined) {
      values.push(category_id === "" ? null : category_id)
      setClauses.push(`category_id = $${values.length}`)
    }
    if (newThumbnailKey) {
      values.push(newThumbnailKey)
      setClauses.push(`thumbnail = $${values.length}`)
    }

    // Always bump updated_at
    setClauses.push(`updated_at = CURRENT_TIMESTAMP`)

    if (setClauses.length === 1 && newImageKeys.length === 0)
      return res.status(400).json({ error: "No fields provided to update" })

    values.push(id)
    const whereIndex = values.length

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      const existing = await client.query(
        `SELECT thumbnail FROM products WHERE id = $1`,
        [id]
      )

      if (existing.rows.length === 0) {
        await client.query("ROLLBACK")
        if (newThumbnailKey) await deleteFile(newThumbnailKey)
        for (const k of newImageKeys) await deleteFile(k)
        return res.status(404).json({ error: "Product not found" })
      }

      const oldThumbnailKey = existing.rows[0].thumbnail

      await client.query(
        `UPDATE products SET ${setClauses.join(", ")} WHERE id = $${whereIndex}`,
        values
      )

      for (const key of newImageKeys) {
        await client.query(
          `INSERT INTO product_images (product_id, image_url) VALUES ($1,$2)`,
          [id, key]
        )
      }

      await client.query("COMMIT")

      // Delete old thumbnail from Supabase only after successful DB commit
      if (newThumbnailKey && oldThumbnailKey) await deleteFile(oldThumbnailKey)

      res.json({ success: true })
    } catch (err) {
      await client.query("ROLLBACK")
      if (newThumbnailKey) await deleteFile(newThumbnailKey)
      for (const k of newImageKeys) await deleteFile(k)
      console.error("PATCH /products/:id DB error:", err)
      res.status(500).json({ error: "Failed to update product" })
    } finally {
      client.release()
    }
  }
)

// ─── DELETE PRODUCT ───────────────────────────────────────────────────────────
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
    // product_images cascade-delete automatically

    await client.query("COMMIT")

    // Delete from Supabase only after successful DB delete
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

// ─── ADD EXTRA IMAGES ─────────────────────────────────────────────────────────
router.post(
  "/:id/images",
  authenticateToken,
  upload.array("images", 10),
  async (req, res) => {
    const { id } = req.params
    const files = req.files as Express.Multer.File[]

    let uploadedKeys: string[] = []

    try {
      uploadedKeys = await uploadAll(files)
    } catch (err) {
      console.error("POST /products/:id/images upload error:", err)
      return res.status(500).json({ error: "Failed to upload images" })
    }

    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      const exists = await client.query(
        `SELECT id FROM products WHERE id = $1`,
        [id]
      )

      if (exists.rows.length === 0) {
        await client.query("ROLLBACK")
        for (const k of uploadedKeys) await deleteFile(k)
        return res.status(404).json({ error: "Product not found" })
      }

      for (const key of uploadedKeys) {
        await client.query(
          `INSERT INTO product_images (product_id, image_url) VALUES ($1,$2)`,
          [id, key]
        )
      }

      await client.query("COMMIT")
      res.json({ success: true })
    } catch (err) {
      await client.query("ROLLBACK")
      for (const k of uploadedKeys) await deleteFile(k)
      console.error("POST /products/:id/images DB error:", err)
      res.status(500).json({ error: "Failed to add images" })
    } finally {
      client.release()
    }
  }
)

// ─── DELETE IMAGE ─────────────────────────────────────────────────────────────
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

    // Delete from Supabase only after successful DB delete
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