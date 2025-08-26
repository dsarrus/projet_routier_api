// routes/admin/users.js
const { Router } = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

module.exports = (pool) => {
  const router = Router();

  // Middleware admin seulement
  const isAdmin = async (req, res, next) => {
    const token = req.header("x-auth-token");
    if (!token) return next(); // Continue without user if no token
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const user = await pool.query("SELECT role FROM users WHERE id = $1", [
        decoded.id,
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

  // Lister tous les utilisateurs
  router.get("/", isAdmin, async (req, res) => {
    try {
      const { search, role } = req.query;
      let query =
        "SELECT id, username, email, role, is_active, created_at, last_login FROM users";
      const params = [];

      if (search || role) {
        query += " WHERE";
        if (search) {
          query += ` (username ILIKE $${params.length + 1} OR email ILIKE $${
            params.length + 1
          })`;
          params.push(`%${search}%`);
        }
        if (search && role) query += " AND";
        if (role) {
          query += ` role = $${params.length + 1}`;
          params.push(role);
        }
      }

      query += " ORDER BY created_at DESC";
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Créer un utilisateur (admin seulement)
  router.post("/", isAdmin, async (req, res) => {
    try {
      const { username, email, password, role } = req.body;

      // Validation
      const errors = [];
      if (!username)
        errors.push({
          field: "username",
          message: "Le nom d'utilisateur est requis",
        });
      if (!email)
        errors.push({ field: "email", message: "L'email est requis" });
      if (!password)
        errors.push({
          field: "password",
          message: "Le mot de passe est requis",
        });
      if (password && password.length < 8)
        errors.push({
          field: "password",
          message: "Le mot de passe doit contenir au moins 8 caractères",
        });

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push({ field: "email", message: "Email invalide" });
      }

      if (errors.length > 0) {
        return res.status(400).json({
          message: "Validation failed",
          errors,
        });
      }

      // Vérifier si l'utilisateur existe déjà
      const userExists = await pool.query(
        "SELECT id FROM users WHERE username = $1 OR email = $2",
        [username, email]
      );

      if (userExists.rows.length > 0) {
        return res.status(400).json({
          message: "Validation failed",
          errors: [
            {
              field: "general",
              message: "Un utilisateur avec ce nom ou email existe déjà",
            },
          ],
        });
      }

      // Hasher le mot de passe
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(tempPassword, salt);

      // Créer l'utilisateur
      const newUser = await pool.query(
        `INSERT INTO users (username, email, password, role) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id, username, email, role, created_at`,
        [username, email, hashedPassword, role || "user"]
      );

      res.status(201).json(newUser.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({
        message: "Erreur serveur",
        error: err.message,
        errors: [
          { field: "general", message: "Une erreur inattendue est survenue" },
        ],
      });
    }
  });

  // Mettre à jour un utilisateur
  router.put("/:id", isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { username, email, role, is_active } = req.body;

      const result = await pool.query(
        `UPDATE users 
         SET username = $1, email = $2, role = $3, is_active = $4 
         WHERE id = $5
         RETURNING id, username, email, role, is_active, created_at`,
        [username, email, role, is_active, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Utilisateur non trouvé" });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Réinitialiser le mot de passe
  router.post("/:id/reset-password", isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);

      await pool.query("UPDATE users SET password = $1 WHERE id = $2", [
        hashedPassword,
        id,
      ]);

      res.json({ message: "Mot de passe réinitialisé" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  return router;
};
