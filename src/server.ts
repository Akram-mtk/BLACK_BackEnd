import express from "express"
import cors from "cors"
import dotenv from "dotenv"

import authRoutes from "./auth"
import productRoutes from "./products"

dotenv.config()

const app = express()
// app.use(cors({ origin: "https://yourdomain.com" }))
app.use(cors())
app.use(express.json())
app.use("/uploads", express.static("uploads"))

app.use("/auth", authRoutes)
app.use("/products", productRoutes)


app.get("/", (req, res) => {
  res.send("Hello World")
})

app.listen(3000, () => {
  console.log("Server running on port 3000")
})


