import multer from 'multer';

export const MAX_FILES = 10;
export const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

// memoryStorage keeps the file in RAM as req.files[i].buffer.
// We only need the bytes long enough to extract text, and it means
// nothing is written to disk (disks on free hosting are wiped on restart).
export const uploadPdfs = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    // First check only (type/name can be faked); the "%PDF-" header is checked after upload
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      const err = new Error(`${file.originalname} is not a PDF`);
      err.status = 400;
      cb(err);
    }
  },
}).array('files', MAX_FILES); // form field name must be "files"
