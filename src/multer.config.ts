import multer from "multer"
import path from "path"
import crypto from "crypto"

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]
const MAX_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

const storage = multer.diskStorage({

  destination: (req, file, cb) => {
    cb(null, "uploads/")
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    const random = crypto.randomBytes(16).toString("hex")
    cb(null, `${Date.now()}-${random}${ext}`)
  }

})

export const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error(`Invalid file type. Allowed: ${ALLOWED_TYPES.join(", ")}`))
    }
  }
})