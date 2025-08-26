const jwt = require("jsonwebtoken");
const { pool } = require("pg");

module.exports = async (req, res, next) => {
  const token = req.header("x-auth-token");

  if (!token) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

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
    res.status(401).json({ message: "Token is not valid" });
  }
};
