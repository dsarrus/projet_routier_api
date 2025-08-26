const { Router } = require("express");

module.exports = (pool) => {
  const router = Router();
  const authenticate = require("../middleware/authenticate");

  // Obtenir les logs (admin seulement)
  router.get("/", authenticate, async (req, res) => {
    try {
      // Vérifier si l'utilisateur est admin
      if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Accès refusé" });
      }

      const { page = 1, limit = 50, user_id, action_type } = req.query;
      const offset = (page - 1) * limit;

      let query = `
        SELECT ua.*, u.username 
        FROM user_actions ua
        LEFT JOIN users u ON ua.user_id = u.id
        WHERE 1=1
      `;
      const params = [];
      let paramCount = 1;

      if (user_id) {
        query += ` AND ua.user_id = $${paramCount}`;
        params.push(user_id);
        paramCount++;
      }

      if (action_type) {
        query += ` AND ua.action_type = $${paramCount}`;
        params.push(action_type);
        paramCount++;
      }

      query += ` ORDER BY ua.created_at DESC LIMIT $${paramCount} OFFSET $${
        paramCount + 1
      }`;
      params.push(limit, offset);

      const logs = await pool.query(query, params);
      res.json(logs.rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};
