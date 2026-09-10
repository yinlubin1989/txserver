/** GET /api/photos returns file metadata, not an array of filenames. */
export interface PhotoFile {
  name: string;
  mtime: number;
}

export interface PhotosResponse {
  photos: PhotoFile[];
}
