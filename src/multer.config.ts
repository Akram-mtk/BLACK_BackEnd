import multer from "multer"

const storage = multer.diskStorage({

  destination: (req, file, cb) => {
    cb(null, "uploads/")
  },

  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + file.originalname
    cb(null, unique)
  }

})

export const upload = multer({ storage })