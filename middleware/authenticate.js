// middleware/authenticate.js

const jwt = require("jsonwebtoken");
module.exports = (pool) => async (req, res, next) => {
  try {
    const token = req.header("x-auth-token");

    if (!token) {
      return res.status(401).json({ message: "Authorization token missing" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { rows } = await pool.query(
      "SELECT id, role, is_active FROM users WHERE id = $1",
      [decoded.id]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({ message: "User not found or inactive" });
    }

    req.user = { id: rows[0].id, role: rows[0].role };
    next();
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(401).json({
      message:
        err.name === "TokenExpiredError" ? "Token expired" : "Invalid token",
    });
  }
};
