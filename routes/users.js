const { Router } = require('express');

module.exports = (pool) => {
  const router = Router();

  // Obtenir tous les utilisateurs (pour admin)
  router.get('/', async (req, res) => {
    try {
      const users = await pool.query(
        'SELECT id, username, email, created_at FROM users ORDER BY created_at DESC'
      );
      res.json(users.rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  });

  // Obtenir un utilisateur spécifique
  router.get('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const user = await pool.query(
        'SELECT id, username, email, created_at FROM users WHERE id = $1',
        [id]
      );
      
      if (user.rows.length === 0) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      res.json(user.rows[0]);
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  });

  return router;
};