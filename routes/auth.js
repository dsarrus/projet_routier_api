const { Router } = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const isAdmin = async (req, res, next) => {
  try {
    const user = await pool.query("SELECT role FROM users WHERE id = $1", [
      req.user.id,
    ]);

    if (user.rows[0]?.role !== "admin") {
      return res.status(403).json({ message: "Accès refusé" });
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

module.exports = (pool, authenticate) => {
  const router = Router();

  // Inscription
  router.post("/register", async (req, res) => {
    try {
      const { username, email, password } = req.body;

      // Vérifier si l'utilisateur existe déjà
      const userExists = await pool.query(
        "SELECT * FROM users WHERE username = $1 OR email = $2",
        [username, email]
      );

      if (userExists.rows.length > 0) {
        return res.status(400).json({ message: "User already exists" });
      }

      // Hasher le mot de passe
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Créer l'utilisateur
      const newUser = await pool.query(
        "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *",
        [username, email, hashedPassword]
      );

      // Générer un token JWT
      const token = jwt.sign(
        { id: newUser.rows[0].id, username: newUser.rows[0].username },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );

      res.status(201).json({ token, user: newUser.rows[0] });
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Connexion
  router.post("/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      // Vérifier si l'utilisateur existe
      const user = await pool.query("SELECT * FROM users WHERE username = $1", [
        username,
      ]);

      if (user.rows.length === 0) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      // Vérifier le mot de passe
      const isMatch = await bcrypt.compare(password, user.rows[0].password);

      if (!isMatch) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      // Générer un token JWT
      const token = jwt.sign(
        { id: user.rows[0].id, username: user.rows[0].username },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );

      res.json({ token, user: user.rows[0] });
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Vérifier le token (nouvelle route)
  router.get("/verify", authenticate, async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT id, username, email, role FROM users WHERE id = $1",
        [req.user.id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ user: rows[0] });
    } catch (err) {
      console.error("Verify error:", err);
      res.status(500).json({ message: "Error verifying user" });
    }
  });

  return router;
};
