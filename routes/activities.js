const { Router } = require("express");
const jwt = require("jsonwebtoken");

module.exports = (pool, authenticate) => {
  const router = Router();

  // Créer une nouvelle activité
  router.post("/:lotId", authenticate, async (req, res) => {
    try {
      const { lotId } = req.params;
      const { date, weather, workforce, incidents, observations } = req.body;

      // Validation
      const errors = [];
      if (!date) errors.push({ field: "date", message: "La date est requise" });
      if (!weather)
        errors.push({ field: "weather", message: "La météo est requise" });
      if (!workforce)
        errors.push({
          field: "workforce",
          message: "Les effectifs sont requis",
        });

      if (errors.length > 0) {
        return res.status(400).json({
          message: "Validation failed",
          errors,
        });
      }

      const newActivity = await pool.query(
        `INSERT INTO activities (
          lot_id, date, weather, workforce, incidents, observations, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [lotId, date, weather, workforce, incidents, observations, req.user.id]
      );

      res.status(201).json(newActivity.rows[0]);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({
        message: "Server error",
        error: err.message,
      });
    }
  });

  // Obtenir les activités d'un lot
  router.get("/:lotId", authenticate, async (req, res) => {
    try {
      const { lotId } = req.params;
      const { fromDate, toDate } = req.query;

      let query = `SELECT a.*, u.username as creator 
                   FROM activities a
                   JOIN users u ON a.created_by = u.id
                   WHERE a.lot_id = $1`;
      const params = [lotId];

      if (fromDate) {
        query += ` AND a.date >= $${params.length + 1}`;
        params.push(fromDate);
      }

      if (toDate) {
        query += ` AND a.date <= $${params.length + 1}`;
        params.push(toDate);
      }

      query += " ORDER BY a.date DESC";

      const activities = await pool.query(query, params);
      res.json(activities.rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Mettre à jour une activité
  router.put("/:id", authenticate, async (req, res) => {
    try {
      const { id } = req.params;
      const { date, weather, workforce, incidents, observations } = req.body;

      // Validation
      const errors = [];
      if (!date) errors.push({ field: "date", message: "La date est requise" });
      if (!weather)
        errors.push({ field: "weather", message: "La météo est requise" });
      if (!workforce)
        errors.push({
          field: "workforce",
          message: "Les effectifs sont requis",
        });

      if (errors.length > 0) {
        return res.status(400).json({
          message: "Validation failed",
          errors,
        });
      }

      const updatedActivity = await pool.query(
        `UPDATE activities SET
        date = $1,
        weather = $2,
        workforce = $3,
        incidents = $4,
        observations = $5,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *`,
        [date, weather, workforce, incidents, observations, id]
      );

      if (updatedActivity.rows.length === 0) {
        return res.status(404).json({ message: "Activité non trouvée" });
      }

      res.json(updatedActivity.rows[0]);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({
        message: "Server error",
        error: err.message,
      });
    }
  });

  // Supprimer une activité
  router.delete("/:id", authenticate, async (req, res) => {
    try {
      const { id } = req.params;
      const deletedActivity = await pool.query(
        "DELETE FROM activities WHERE id = $1 RETURNING *",
        [id]
      );

      if (deletedActivity.rows.length === 0) {
        return res.status(404).json({ message: "Activité non trouvée" });
      }

      res.json({ message: "Activité supprimée avec succès" });
    } catch (err) {
      console.error(err.message);
      res.status(500).json({
        message: "Server error",
        error: err.message,
      });
    }
  });

  return router;
};
