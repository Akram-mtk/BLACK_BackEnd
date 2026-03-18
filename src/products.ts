import { Router } from "express"
import pool from "./db"
import { upload } from "./multer.config"
import fs from "fs"
import path from "path"
import { authenticateToken } from "./auth.middleware"

const router = Router()

const BASE_URL = process.env.BASE_IMAGE_URL

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

    const thumbnail = files.thumbnail?.[0]?.filename
    const images = files.images || []

    try {
      const product = await pool.query(
        `INSERT INTO products (name, description, price, category, thumbnail)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id`,
        [name, description, price, category, thumbnail]
      )

      const productId = product.rows[0].id

      for (const file of images) {
        await pool.query(
          `INSERT INTO product_images (product_id, image_url)
           VALUES ($1,$2)`,
          [productId, file.filename]
        )
      }

      res.json({ success: true })
    } catch (err) {
      res.status(500).json(err)
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
        '${BASE_URL}' || p.thumbnail AS thumbnail,
        COALESCE(
          json_agg('${BASE_URL}' || pi.image_url)
          FILTER (WHERE pi.id IS NOT NULL),
          '[]'
        ) AS images
      FROM products p
      LEFT JOIN product_images pi
      ON p.id = pi.product_id
      GROUP BY p.id
      ORDER BY p.id DESC
    `)

    res.json(result.rows)
  } catch (err) {
    res.status(500).json(err)
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
    res.status(500).json(err)
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
        '${BASE_URL}' || p.thumbnail AS thumbnail,
        COALESCE(
          json_agg('${BASE_URL}' || pi.image_url)
          FILTER (WHERE pi.id IS NOT NULL),
          '[]'
        ) AS images
      FROM products p
      LEFT JOIN product_images pi
      ON p.id = pi.product_id
      WHERE p.id=$1
      GROUP BY p.id
    `, [id])

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Product not found" })

    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json(err)
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
        '${BASE_URL}' || p.thumbnail AS thumbnail,
        COALESCE(
          json_agg('${BASE_URL}' || pi.image_url)
          FILTER (WHERE pi.id IS NOT NULL),
          '[]'
        ) AS images
      FROM products p
      LEFT JOIN product_images pi
      ON p.id = pi.product_id
      WHERE p.category=$1
      GROUP BY p.id
      ORDER BY p.id DESC
    `, [category])

    res.json(result.rows)
  } catch (err) {
    res.status(500).json(err)
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

    const thumbnail = files.thumbnail?.[0]?.filename
    const images = files.images || []

    try {
      await pool.query(
        `UPDATE products
         SET name=$1, description=$2, price=$3, category=$4,
             thumbnail = COALESCE($5, thumbnail)
         WHERE id=$6`,
        [name, description, price, category, thumbnail, id]
      )

      for (const file of images) {
        await pool.query(
          `INSERT INTO product_images (product_id,image_url)
           VALUES ($1,$2)`,
          [id, file.filename]
        )
      }

      res.json({ success: true })
    } catch (err) {
      res.status(500).json(err)
    }
  }
)

// DELETE PRODUCT
router.delete("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params

  try {
    // delete thumbnail
    const product = await pool.query(
      `SELECT thumbnail FROM products WHERE id=$1`,
      [id]
    )

    if (product.rows[0]?.thumbnail) {
      const filePath = path.join("uploads", product.rows[0].thumbnail)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }

    // delete images
    const images = await pool.query(
      `SELECT image_url FROM product_images WHERE product_id=$1`,
      [id]
    )

    for (const img of images.rows) {
      const filePath = path.join("uploads", img.image_url)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }

    await pool.query(`DELETE FROM products WHERE id=$1`, [id])

    res.json({ success: true })
  } catch (err) {
    res.status(500).json(err)
  }
})

// ADD EXTRA IMAGES
router.post(
  "/:id/images",
  authenticateToken,
  upload.array("images"),
  async (req, res) => {
    const { id } = req.params
    const files = req.files as Express.Multer.File[]

    try {
      for (const file of files) {
        await pool.query(
          `INSERT INTO product_images (product_id,image_url)
           VALUES ($1,$2)`,
          [id, file.filename]
        )
      }

      res.json({ success: true })
    } catch (err) {
      res.status(500).json(err)
    }
  }
)

// DELETE IMAGE
router.delete("/images/:id", authenticateToken, async (req, res) => {
  const { id } = req.params

  try {
    const result = await pool.query(
      `SELECT image_url FROM product_images WHERE id=$1`,
      [id]
    )

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Image not found" })

    const filePath = path.join("uploads", result.rows[0].image_url)

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)

    await pool.query(`DELETE FROM product_images WHERE id=$1`, [id])

    res.json({ success: true })
  } catch (err) {
    res.status(500).json(err)
  }
})

export default router