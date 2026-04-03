import { createClient } from "@supabase/supabase-js"
import { randomBytes } from "crypto"
import path from "path"

const supabase = createClient(
  process.env.SUPABASE_URL     as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string  // use service role, not anon key
)

const BUCKET = process.env.SUPABASE_BUCKET as string

// Upload a file buffer — returns the stored key
export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<string> {
  const ext = path.extname(originalName).toLowerCase()
  const key = `${Date.now()}-${randomBytes(16).toString("hex")}${ext}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, buffer, { contentType: mimeType })

  if (error) throw error

  return key
}

// Delete a file by key (non-throwing)
export async function deleteFile(key: string): Promise<void> {
  try {
    await supabase.storage.from(BUCKET).remove([key])
  } catch {
    // Already deleted or never existed — not fatal
  }
}