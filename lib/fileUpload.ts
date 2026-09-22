"use client";

/**
 * Replacement for 'zite-file-upload-sdk'. Zite hosted uploaded files on its
 * own storage and gave back a fileUrl; we don't have that backend, so this
 * creates a local object URL instead (works fine for the current session,
 * but the URL won't survive a page refresh or be visible to other users).
 *
 * TODO (later phase): wire this to real storage (e.g. Google Drive via the
 * same service account, or Vercel Blob) if masterlist files need to persist
 * and be viewable across sessions/users. For now this unblocks the upload
 * flow so createUpload() gets called with a working reference.
 */
export async function uploadFile(params: { data: File; filename: string }): Promise<{ fileUrl: string }> {
  const fileUrl = URL.createObjectURL(params.data);
  return { fileUrl };
}
