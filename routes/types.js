const { Router } = require("express");
const jwt = require("jsonwebtoken");

module.exports = (pool) => {
  const router = Router();

  // Middleware d'authentification
  const authenticate = (req, res, next) => {
    const token = req.header("x-auth-token");

    console.log("Token reçu:", token); // Debug
    console.log("JWT Secret:", process.env.JWT_SECRET); // Debug
    if (!token) {
      return res
        .status(401)
        .json({ message: "No token, authorization denied" });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ message: "Token is not valid" });
    }
  };

  // Obtenir tous les types de documents
  router.get("/", async (req, res) => {
    try {
      const types = await pool.query(
        "SELECT * FROM document_types ORDER BY name"
      );
      res.json(types.rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Créer un nouveau type de document (protégé par authentification)
  router.post("/", authenticate, async (req, res) => {
    try {
      const { name, description } = req.body;

      // Validation
      if (!name) {
        return res.status(400).json({ message: "Le nom du type est requis" });
      }

      // Vérifier si le type existe déjà
      const typeExists = await pool.query(
        "SELECT * FROM document_types WHERE name = $1",
        [name]
      );

      if (typeExists.rows.length > 0) {
        return res
          .status(400)
          .json({ message: "Ce type de document existe déjà" });
      }

      // Créer le nouveau type
      const newType = await pool.query(
        "INSERT INTO document_types (name, description) VALUES ($1, $2) RETURNING *",
        [name, description]
      );

      res.status(201).json(newType.rows[0]);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Mettre à jour un type
  router.put("/:id", authenticate, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description } = req.body;

      const updatedType = await pool.query(
        "UPDATE document_types SET name = $1, description = $2 WHERE id = $3 RETURNING *",
        [name, description, id]
      );

      res.json(updatedType.rows[0]);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Supprimer un type
  router.delete("/:id", authenticate, async (req, res) => {
    try {
      const { id } = req.params;

      // Vérifier si le type est utilisé
      const usedType = await pool.query(
        "SELECT id FROM documents WHERE type_id = $1 LIMIT 1",
        [id]
      );

      if (usedType.rows.length > 0) {
        return res.status(400).json({
          message:
            "Ce type est utilisé par des documents et ne peut être supprimé",
        });
      }

      await pool.query("DELETE FROM document_types WHERE id = $1", [id]);
      res.json({ message: "Type supprimé" });
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  return router;
};
