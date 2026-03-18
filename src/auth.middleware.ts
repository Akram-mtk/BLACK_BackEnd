import { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"

const SECRET = process.env.JWT_SECRET as string

export interface AuthRequest extends Request {
  user?: any
}

export function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {

  const authHeader = req.headers.authorization
  const token = authHeader?.split(" ")[1]

  if (!token)
    return res.sendStatus(401)

  jwt.verify(token, SECRET, (err, user) => {

    if (err)
      return res.sendStatus(403)

    req.user = user
    next()

  })

}