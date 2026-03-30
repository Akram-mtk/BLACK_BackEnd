import express from "express"
import cors from "cors"
import dotenv from "dotenv"

import authRoutes from "./auth"
import productRoutes from "./products"

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT) || 3000

// Restrict to your front-end origin in production
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }))
app.use(express.json())
app.use("/uploads", express.static("uploads"))

app.use("/auth", authRoutes)
app.use("/products", productRoutes)


app.get("/", (req, res) => {
  res.send("Hello World")
})


app.get("/", (req, res) => {
  res.send("Hello World")
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})