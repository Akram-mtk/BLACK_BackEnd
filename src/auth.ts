import { Router } from "express"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"
import pool from "./db"

const router = Router()

const SECRET = process.env.JWT_SECRET as string

router.post("/register", async (req, res) => {

  

  try {
    const { username, password } = req.body

    const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS))

    await pool.query(
      "INSERT INTO users(username,password) VALUES($1,$2)",
      [username, hash]
    )

    res.json({ message: "user created" })
  } catch (err) {
    res.status(500).json({ error: "Registration failed" })
  }

})

router.post("/login", async (req, res) => {

  

  try {
    const { username, password } = req.body

    const result = await pool.query(
      "SELECT * FROM users WHERE username=$1",
      [username]
    )

    const user = result.rows[0]

    if (!user)
      return res.status(401).json({ error: "invalid credentials" })

    const valid = await bcrypt.compare(password, user.password)

    if (!valid)
      return res.status(401).json({ error: "invalid credentials" })

    const token = jwt.sign(
      { id: user.id },
      SECRET,
      { expiresIn: Number(process.env.JWT_EXPIRES_IN) }
    )

    res.json({ token })
  } catch (err) {
    res.status(500).json({ error: "An error occured" })
  }

})

export default router