import express from "express"
import cors from "cors"
import dotenv from "dotenv"

import authRoutes from "./auth"
import productRoutes from "./products"
import categoryRoutes from "./categories"
import orderRoutes from "./orders"

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT) || 3000

// Restrict to your front-end origin in production
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }))
app.use(express.json())
app.use("/uploads", express.static("uploads"))

app.use("/auth", authRoutes)
app.use("/products", productRoutes)
app.use("/categories", categoryRoutes)
app.use("/orders", orderRoutes)

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Unhandled error:", err)
  res.status(err.status ?? 500).json({ error: err.message ?? "Internal server error" })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})