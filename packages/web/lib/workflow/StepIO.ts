// Shared file-reference payload types used by every synchronous step adapter
// (Task 5). A step's `file`-kind input/output is always a `FileRef` pointing
// at an on-disk location under a job dir; `files`-kind payloads are `FilesRef`.

export interface FileRef {
  path: string;
  filename: string;
}

export interface FilesRef {
  files: FileRef[];
}
