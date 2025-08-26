require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const fileupload = require("express-fileupload");
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();
const port = process.env.PORT || 5000;

// Configuration CORS pour le déploiement
const corsOptions = {
  origin: process.env.NODE_ENV === process.env.FRONTEND_URL /*"production"
      ? process.env.FRONTEND_URL || "http://localhost:3000"
      : "http://localhost:3000"*/,
  credentials: true,
  optionsSuccessStatus: 200,
};

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());
app.use(
  fileupload({
    useTempFiles: true,
    tempFileDir: "/tmp/",
    limits: { fileSize: parseInt(process.env.FILE_MAX_SIZE) },
  })
);

// Servir les fichiers statics en production
/*if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/build")));

  app.get("/{*any}", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/build", "index.html"));
  });
}*/

// Vérifier si le dossier uploads existe
const uploadDir = process.env.FILE_UPLOAD_PATH;
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Connexion à la base de données
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Testez la connexion au démarrage
pool
  .query("SELECT NOW()")
  .then(() => console.log("Database connected"))
  .catch((err) => console.error("Database connection error", err));

app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.path}`);
  console.log("Headers:", req.headers);
  next();
});

// Routes
const authenticate = require("./middleware/authenticate")(pool);
app.use("/api/auth", require("./routes/auth")(pool, authenticate));
app.use("/api/admin/users", require("./routes/admin/users")(pool));
app.use("/api/logs", require("./routes/logs")(pool));
app.use("/api/lots", require("./routes/lots")(pool));
app.use("/api/documents", require("./routes/documents")(pool));
app.use("/api/types", require("./routes/types")(pool));
app.use("/api/users", require("./routes/users")(pool));
app.use("/api/activities", require("./routes/activities")(pool, authenticate));
app.use("/api/meetings", require("./routes/meetings")(pool));
app.use("/api/communications", require("./routes/communications")(pool));

// Gestion des erreurs
// Gestion améliorée des erreurs
app.use((err, req, res, next) => {
  console.error(err.stack);

  // Journalisation des erreurs serveur
  if (req.user) {
    pool
      .query(
        `INSERT INTO user_actions 
       (user_id, action_type, details) 
       VALUES ($1, $2, $3)`,
        [
          req.user.id,
          "server_error",
          `Error in ${req.method} ${req.path}: ${err.message}`,
        ]
      )
      .catch((e) => console.error("Error logging server error:", e));
  }

  res.status(500).json({
    message: "Something broke!",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
