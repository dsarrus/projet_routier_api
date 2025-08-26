const { Router } = require("express");
const jwt = require("jsonwebtoken");

module.exports = (pool) => {
  const router = Router();

  // Middleware pour vérifier le token JWT
  const authenticate = (req, res, next) => {
    const token = req.header("x-auth-token");

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

  // Middleware pour vérifier les droits admin
  const isAdmin = (req, res, next) => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Unauthorized access" });
    }
    next();
  };

  // btenir tous les lots
  router.get("/", async (req, res) => {
    try {
      const lots = await pool.query(
        "SELECT * FROM project_lots ORDER BY number"
      );
      res.json(lots.rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Détails d'un lot avec statistiques
  router.get("/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const lotQuery = pool.query("SELECT * FROM project_lots WHERE id = $1", [
        id,
      ]);
      const docsQuery = pool.query(
        "SELECT COUNT(*) as count FROM documents WHERE lot_id = $1",
        [id]
      );
      const activitiesQuery = pool.query(
        "SELECT COUNT(*) as count FROM activities WHERE lot_id = $1",
        [id]
      );
      const meetingsQuery = pool.query(
        "SELECT COUNT(*) as count FROM meetings WHERE lot_id = $1",
        [id]
      );

      const [lotResult, docsResult, activitiesResult, meetingsResult] =
        await Promise.all([
          lotQuery,
          docsQuery,
          activitiesQuery,
          meetingsQuery,
        ]);

      if (lotResult.rows.length === 0) {
        return res.status(404).json({ message: "Lot not found" });
      }

      res.json({
        ...lotResult.rows[0],
        stats: {
          documents: parseInt(docsResult.rows[0].count),
          activities: parseInt(activitiesResult.rows[0].count),
          meetings: parseInt(meetingsResult.rows[0].count),
        },
      });
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Documents d'un lot avec filtres
  router.get("/:id/documents", async (req, res) => {
    try {
      const { id } = req.params;
      const { search, type, fromDate, toDate } = req.query;

      let query = `
        SELECT 
          d.*, 
          dt.name as type_name,
          u.username as creator,
          (SELECT COUNT(*) FROM document_versions WHERE document_id = d.id) as version_count
        FROM documents d
        JOIN document_types dt ON d.type_id = dt.id
        JOIN users u ON d.created_by = u.id
        WHERE d.lot_id = $1
      `;
      const params = [id];
      let paramIndex = 2;

      if (search) {
        query += ` AND (
          d.title ILIKE $${paramIndex} OR 
          d.description ILIKE $${paramIndex} OR
          d.keywords ILIKE $${paramIndex}
        )`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      if (type) {
        query += ` AND d.type_id = $${paramIndex}`;
        params.push(type);
        paramIndex++;
      }

      if (fromDate) {
        query += ` AND d.created_at >= $${paramIndex}`;
        params.push(new Date(fromDate));
        paramIndex++;
      }

      if (toDate) {
        query += ` AND d.created_at <= $${paramIndex}`;
        params.push(new Date(toDate));
        paramIndex++;
      }

      query += ` ORDER BY d.created_at DESC`;

      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Activités d'un lot avec filtres
  router.get("/:id/activities", authenticate, async (req, res) => {
    try {
      const { id } = req.params;
      const { fromDate, toDate } = req.query;

      let query = `
      SELECT 
        a.*, 
        u.username as creator_name
      FROM activities a
      JOIN users u ON a.created_by = u.id
      WHERE a.lot_id = $1
    `;
      const params = [id];

      if (fromDate) {
        query += ` AND a.date >= $${params.length + 1}`;
        params.push(fromDate);
      }

      if (toDate) {
        query += ` AND a.date <= $${params.length + 1}`;
        params.push(toDate);
      }

      // Tri par date d'activité (pas par due_date qui n'existe pas)
      query += ` ORDER BY a.date DESC`;

      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ message: "Server error" });
    }
  });
  // routes/lots.js

  // Ajoutez cette route à votre fichier lots.js
  router.get("/:id/meetings", authenticate, async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `SELECT m.*, u.username as creator_name
       FROM meetings m
       JOIN users u ON m.created_by = u.id
       WHERE m.lot_id = $1
       ORDER BY m.date, m.time`,
        [id]
      );

      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });
  // Communication d'un lot
  router.get("/:id/communications", authenticate, async (req, res) => {
    try {
      const { id } = req.params;
      const { type } = req.query;

      let query = `
        SELECT 
          c.*, 
          u.username as author_name,
          u2.username as recipient_name
        FROM communications c
        JOIN users u ON c.author_id = u.id
        LEFT JOIN users u2 ON c.recipient_id = u2.id
        WHERE c.lot_id = $1
      `;
      const params = [id];

      if (type) {
        query += ` AND c.type = $2`;
        params.push(type);
      }

      query += ` ORDER BY c.created_at DESC`;

      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Statistiques d'un lot (pour le dashboard)
  router.get("/:id/stats", authenticate, async (req, res) => {
    try {
      const { id } = req.params;

      const statsQuery = `
        SELECT 
          (SELECT COUNT(*) FROM documents WHERE lot_id = $1) as document_count,
          (SELECT COUNT(*) FROM activities WHERE lot_id = $1) as activity_count,
          (SELECT COUNT(*) FROM activities WHERE lot_id = $1 AND status = 'completed') as completed_activities,
          (SELECT COUNT(*) FROM communications WHERE lot_id = $1) as communication_count,
          (SELECT COUNT(*) FROM documents WHERE lot_id = $1 AND created_at >= NOW() - INTERVAL '7 days') as recent_documents
      `;

      const { rows } = await pool.query(statsQuery, [id]);
      res.json(rows[0]);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Dans votre routeur backend (lot.js)
  router.get("/:id/documents/:docId", async (req, res) => {
    try {
      const doc = await pool.query(
        `SELECT d.*, dt.name as type_name, u.username as creator
       FROM documents d
       JOIN document_types dt ON d.type_id = dt.id
       JOIN users u ON d.created_by = u.id
       WHERE d.id = $1 AND d.lot_id = $2`,
        [req.params.docId, req.params.id]
      );

      if (doc.rows.length === 0) {
        return res.status(404).json({ message: "Document not found" });
      }

      res.json(doc.rows[0]);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};
