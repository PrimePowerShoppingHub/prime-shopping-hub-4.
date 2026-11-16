
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const db = require("./database");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Create uploads folder if it does not exist
const dataFolder =
  process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;

const uploadFolder = path.join(dataFolder, "uploads");

if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, { recursive: true });
}

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Admin sessions
app.use(
  session({
    secret: process.env.ADMIN_SESSION_SECRET || "change-this-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 2 * 60 * 60 * 1000,
      httpOnly: true,
      secure: false,
      sameSite: "lax"
    }
  })
);

// Product image upload settings
const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, uploadFolder);
  },
  filename: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const filename =
      Date.now() + "-" + Math.round(Math.random() * 1e9) + extension;

    callback(null, filename);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!file.mimetype.startsWith("image/")) {
      return callback(new Error("Only image files are allowed."));
    }
    callback(null, true);
  }
});
// Temporary recovery-file upload settings
const recoveryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 101
  }
});

function requireRecoveryToken(req, res, next) {
  const token = req.headers["x-recovery-token"];
  const expectedToken = process.env.RECOVERY_UPLOAD_TOKEN;

  if (
    !expectedToken ||
    typeof token !== "string" ||
    token.length !== expectedToken.length ||
    !crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(expectedToken)
    )
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized."
    });
  }

  next();
}
// TEMPORARY PROTECTED RECOVERY ROUTE
app.post(
  "/api/recovery/upload",
  requireRecoveryToken,
  recoveryUpload.fields([
    { name: "database", maxCount: 1 },
    { name: "images", maxCount: 100 }
  ]),
  (req, res) => {
    try {
      const token = req.headers["x-recovery-token"];
      const expectedToken = process.env.RECOVERY_UPLOAD_TOKEN;

      if (
        !expectedToken ||
        typeof token !== "string" ||
        token.length !== expectedToken.length ||
        !crypto.timingSafeEqual(
          Buffer.from(token),
          Buffer.from(expectedToken)
        )
      ) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized."
        });
      }

      const databaseFile = req.files?.database?.[0];
      const imageFiles = req.files?.images || [];

      if (!databaseFile || !imageFiles.length) {
        return res.status(400).json({
          success: false,
          message: "Database backup and image files are required."
        });
      }

      const recoveryFolder = path.join(dataFolder, "recovery-inbox");
      fs.mkdirSync(recoveryFolder, { recursive: true });

      fs.writeFileSync(
        path.join(recoveryFolder, "database-recovery.db"),
        databaseFile.buffer
      );

      for (const file of imageFiles) {
        const filename = path.basename(file.originalname);

        if (
          filename !== file.originalname ||
          !/^[a-zA-Z0-9_.-]+$/.test(filename) ||
          !/^image\//.test(file.mimetype)
        ) {
          return res.status(400).json({
            success: false,
            message: "Invalid image file."
          });
        }

        fs.writeFileSync(
          path.join(recoveryFolder, filename),
          file.buffer
        );
      }

      res.json({
        success: true,
        message: "Recovery files received.",
        imageCount: imageFiles.length
      });
    } catch (error) {
      console.error("Recovery upload error:", error);

      res.status(500).json({
        success: false,
        message: "Recovery upload failed."
      });
    }
  }
);
// Check whether an administrator is logged in
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }

  return res.status(401).json({
    success: false,
    message: "Please log in as administrator."
  });
}

// Admin login page
app.get("/admin-login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin-login.html"));
});

// Protect the admin dashboard
app.get("/admin.html", (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.redirect("/admin-login.html");
  }

  res.sendFile(path.join(__dirname, "admin.html"));
});

// Admin login API
app.post("/api/admin/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Enter your username and password."
      });
    }

    const admin = db.prepare(
      "SELECT * FROM admins WHERE username = ?"
    ).get(username);

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password."
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      admin.password
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password."
      });
    }

    req.session.admin = {
      id: admin.id,
      username: admin.username
    };

    res.json({
      success: true,
      message: "Login successful."
    });
  } catch (error) {
    console.error("Admin login error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to log in."
    });
  }
});

// Admin logout API
app.post("/api/admin/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to log out."
      });
    }

    res.clearCookie("connect.sid");

    res.json({
      success: true,
      message: "Logged out successfully."
    });
  });
});

// Public product list for the shopping homepage
app.get("/api/products", (req, res) => {
  try {
    const products = db.prepare(
      `SELECT id, name, description, price, category, image, stock
       FROM products
       ORDER BY created_at DESC`
    ).all();

    res.json({
      success: true,
      products
    });
  } catch (error) {
    console.error("Public products error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load products."
    });
  }
});

// Get all products for the admin dashboard
app.get("/api/admin/products", requireAdmin, (req, res) => {
  try {
    const products = db.prepare(
      "SELECT * FROM products ORDER BY created_at DESC"
    ).all();

    res.json({
      success: true,
      products
    });
  } catch (error) {
    console.error("Admin products error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load products."
    });
  }
});

// Add a new product
app.post(
  "/api/admin/products",
  requireAdmin,
  upload.single("image"),
  (req, res) => {
    try {
      const name = String(req.body.name || "").trim();
      const description = String(req.body.description || "").trim();
      const price = Number(req.body.price);
      const category = String(req.body.category || "").trim();
      const stock = Number(req.body.stock);

      if (
        !name ||
        !Number.isFinite(price) ||
        price <= 0 ||
        !Number.isInteger(stock) ||
        stock < 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid name, price and stock quantity."
        });
      }

      const image = req.file
        ? "/uploads/" + req.file.filename
        : "";

      const result = db.prepare(
        `INSERT INTO products
         (name, description, price, category, image, stock)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(name, description, price, category, image, stock);

      res.json({
        success: true,
        message: "Product added successfully.",
        productId: Number(result.lastInsertRowid)
      });
    } catch (error) {
      console.error("Add product error:", error);

      res.status(500).json({
        success: false,
        message: "Unable to add product."
      });
    }
  }
);

// Update an existing product
app.put(
  "/api/admin/products/:id",
  requireAdmin,
  upload.single("image"),
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = db.prepare(
        "SELECT * FROM products WHERE id = ?"
      ).get(id);

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: "Product not found."
        });
      }

      const name = String(req.body.name || "").trim();
      const description = String(req.body.description || "").trim();
      const price = Number(req.body.price);
      const category = String(req.body.category || "").trim();
      const stock = Number(req.body.stock);
      const image = req.file
        ? "/uploads/" + req.file.filename
        : existing.image;

      if (
        !name ||
        !Number.isFinite(price) ||
        price <= 0 ||
        !Number.isInteger(stock) ||
        stock < 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Enter valid product details."
        });
      }

      db.prepare(
        `UPDATE products
         SET name = ?, description = ?, price = ?,
             category = ?, image = ?, stock = ?
         WHERE id = ?`
      ).run(name, description, price, category, image, stock, id);

      res.json({
        success: true,
        message: "Product updated successfully."
      });
    } catch (error) {
      console.error("Update product error:", error);

      res.status(500).json({
        success: false,
        message: "Unable to update product."
      });
    }
  }
);

// Delete a product
app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);

    const result = db.prepare(
      "DELETE FROM products WHERE id = ?"
    ).run(id);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found."
      });
    }

    res.json({
      success: true,
      message: "Product deleted successfully."
    });
  } catch (error) {
    console.error("Delete product error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to delete product."
    });
  }
});

// Initialize Paystack payment
app.post("/api/initialize-payment", async (req, res) => {
  try {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      return res.status(500).json({
        success: false,
        message: "Paystack secret key is missing from .env."
      });
    }

    const email = String(
      req.body.email || req.body.customerEmail || ""
    ).trim();

    const items = req.body.items;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address."
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Your shopping cart is empty."
      });
    }

    let total = 0;

    for (const item of items) {
      const productId = Number(item.id);
      const quantity = Number(item.quantity ?? item.qty);

      if (
        !Number.isInteger(productId) ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 100
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid product or quantity."
        });
      }

      const product = db.prepare(
        "SELECT id, price, stock FROM products WHERE id = ?"
      ).get(productId);

      if (!product) {
        return res.status(400).json({
          success: false,
          message: "A product in your cart no longer exists."
        });
      }

      if (quantity > product.stock) {
        return res.status(400).json({
          success: false,
          message: "Not enough stock available for a product in your cart."
        });
      }

      total += product.price * quantity;
    }

    if (!Number.isFinite(total) || total <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment total."
      });
    }

    const paymentResponse = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + secretKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          amount: Math.round(total * 100)
        })
      }
    );

    const paymentResult = await paymentResponse.json();

    if (!paymentResponse.ok || !paymentResult.status) {
      console.error("Paystack error:", paymentResult);

      return res.status(400).json({
        success: false,
        message: paymentResult.message || "Unable to initialize payment."
      });
    }

    res.json({
      success: true,
      authorization_url: paymentResult.data.authorization_url,
      reference: paymentResult.data.reference
    });
  } catch (error) {
    console.error("Payment initialization error:", error);

    res.status(500).json({
      success: false,
      message: "Payment could not be initialized. Please try again."
    });
  }
});

// Make uploaded product images publicly accessible
app.use("/uploads", express.static(uploadFolder));

// Serve the main website and other public files
app.use(express.static(__dirname));

// Handle image upload errors
app.use((error, req, res, next) => {
  console.error("Server error:", error.message);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  res.status(500).json({
    success: false,
    message: error.message || "Something went wrong."
  });
});

// Start server
app.listen(PORT, () => {
  console.log("Prime Shopping Hub is running at http://localhost:" + PORT);
});
