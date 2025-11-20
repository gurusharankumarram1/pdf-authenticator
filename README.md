# 🛡️ pdf-authenticator

**Fast, lightweight, and secure PDF validator for Node.js.** Detect **real** PDF file format markers and prevent fake or renamed files (like `.txt` or `.exe` disguised as `.pdf`).

---

## 📦 Installation

Install the package using npm or Yarn:

```bash
npm install pdf-authenticator
```

Or using Yarn:

```bash
yarn add pdf-authenticator
```

---

## ⚡ Usage

The core function, `isPdf`, accepts various buffer-like inputs and returns a boolean (`true` or `false`).

```javascript
const fs = require("fs");
const { isPdf } = require("pdf-authenticator");

const fileBuffer = fs.readFileSync("example.pdf");

if (isPdf(fileBuffer)) {
  console.log("✅ Valid PDF: File structure matches the PDF specification.");
} else {
  console.log("❌ Invalid PDF: File is either corrupt or a disguised file type.");
}
```

### ✅ Input Types Supported

| Type            | Supported         | Notes                                                   |
| :-------------- | :---------------- | :------------------------------------------------------ |
| **Buffer**      | ✅                 | Standard Node.js file handling format.                  |
| **Uint8Array**  | ✅                 | Works well with modern APIs.                            |
| **ArrayBuffer** | ✅                 | Used in browser environments and some Node APIs.        |
| **Other**       | ❌ returns `false` | `null`, `undefined`, and standard strings are rejected. |

---

## 🔹 Features and Security

This library performs a **multi-point validation** to ensure a file is structurally a PDF, providing robust security against common file upload attacks.

### Key Security Checks

| Check            | Purpose                                                        | Code Logic                                                        |
| :--------------- | :------------------------------------------------------------- | :---------------------------------------------------------------- |
| **Header Check** | Ensures the file begins with the mandatory PDF signature.      | Scans first 1024 bytes for `trimStart().startsWith("%PDF-")`.     |
| **EOF Check**    | Ensures the required end-of-file marker is present.            | Scans the last 2048 bytes for `%%EOF`.                            |
| **Object Check** | Validates internal structure, confirming it's not a text file. | Scans first 8000 bytes for a PDF object marker (e.g., `1 0 obj`). |

By requiring all three checks to pass, **pdf-authenticator** effectively prevents:

* **File Masquerading:** Blocking files like `.exe` or `.txt` that are simply renamed to `.pdf`.
* **Basic Injection:** Rejecting files that contain the header but lack the necessary internal object structure.
* **Corrupt Files:** Identifying files that are truncated or missing the mandatory `%%EOF` marker.

---

## 🛡️ Express.js Upload Example

This is a typical use case for **backend file validation** in web applications using `multer` for handling multipart form data.

```javascript
const express = require("express");
const multer = require("multer");
const { isPdf } = require("pdf-authenticator");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.post("/upload", upload.single("pdfFile"), (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).send("No file provided.");
  }

  if (!isPdf(file.buffer)) {
    return res.status(400).send("Invalid file type. Only real PDFs are allowed.");
  }

  res.send("PDF uploaded and validated successfully!");
});

app.listen(3000, () => console.log("Server running on port 3000"));
```

---

## ⚠️ Limitations

* **Security Scope:** This library validates the file format structure but **cannot** guarantee that a PDF is completely safe, virus-free, or compliant with all PDF specifications.
* **Minimum Size:** Very small files (less than **200 bytes**) are immediately rejected, as a valid PDF file requires more structural metadata.

---