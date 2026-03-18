import express from "express"
import cors from "cors"
import dotenv from "dotenv"

import authRoutes from "./auth"
import productRoutes from "./products"

dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())
app.use("/uploads", express.static("uploads"))

app.use("/auth", authRoutes)
app.use("/products", productRoutes)

app.listen(3000, () => {
  console.log("Server running on port 3000")
})


