const { Router } = require("express");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

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

  // Télécharger un nouveau document
  router.post("/", authenticate, async (req, res) => {
    try {
      if (!req.files || !req.files.file) {
        return res.status(400).json({
          message: "Aucun fichier téléchargé",
          errors: [
            { field: "file", message: "Veuillez sélectionner un fichier" },
          ],
        });
      }

      const { title, description, type_id, keywords, lot_id } = req.body;
      const file = req.files.file;

      // Validation améliorée
      const errors = [];
      if (!title)
        errors.push({ field: "title", message: "Le titre est requis" });
      if (!type_id)
        errors.push({
          field: "type_id",
          message: "Le type de document est requis",
        });
      if (file.size > parseInt(process.env.FILE_MAX_SIZE)) {
        errors.push({
          field: "file",
          message: `Le fichier est trop volumineux (max ${
            process.env.FILE_MAX_SIZE / 1024 / 1024
          }MB)`,
        });
      }

      if (errors.length > 0) {
        return res.status(400).json({
          message: "Validation failed",
          errors,
        });
      }
      const fileExt = path.extname(file.name);
      const fileName = `${uuidv4()}${fileExt}`;
      const filePath = path.join(process.env.FILE_UPLOAD_PATH, fileName);

      // Déplacer le fichier vers le dossier uploads
      await file.mv(filePath);

      // Enregistrer le document dans la base de données
      const newDoc = await pool.query(
        `INSERT INTO documents (
          title, description, file_path, file_size, file_type, type_id, created_by, keywords, lot_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          title,
          description,
          fileName,
          file.size,
          file.mimetype,
          type_id,
          req.user.id,
          keywords ? keywords.split(",").map((k) => k.trim()) : [],
          lot_id,
        ]
      );

      // Créer la première version du document
      await pool.query(
        `INSERT INTO document_versions (
          document_id, version_number, file_path, created_by, changes_description
        ) VALUES ($1, $2, $3, $4, $5)`,
        [newDoc.rows[0].id, 1, fileName, req.user.id, "Initial version"]
      );

      // Journalisation après création
      await pool.query(
        `INSERT INTO user_actions 
       (user_id, action_type, target_id, target_type, details) 
       VALUES ($1, $2, $3, $4, $5)`,
        [
          req.user.id,
          "upload_document",
          newDoc.rows[0].id,
          "document",
          `Uploaded new document: ${title}`,
        ]
      );

      res.status(201).json(newDoc.rows[0]);
    } catch (err) {
      console.error(err.message);
      // Gestion spécifique de l'erreur PostgreSQL
      if (
        err.message.includes(
          "valeur trop longue pour le type character varying"
        )
      ) {
        return res.status(400).json({
          message: "Certaines données dépassent la taille maximale autorisée",
          details: err.message,
        });
      }
      res.status(500).send("Server error");
    }
  });

  // Obtenir tous les documents
  router.get("/", authenticate, async (req, res) => {
    try {
      const { search, type, fromDate, toDate } = req.query;

      let query = `
        SELECT d.*, u.username as creator, dt.name as type_name 
        FROM documents d
        LEFT JOIN users u ON d.created_by = u.id
        LEFT JOIN document_types dt ON d.type_id = dt.id
        WHERE 1=1
      `;
      const params = [];
      let paramCount = 1;

      if (search) {
        query += ` AND (d.title ILIKE $${paramCount} OR d.description ILIKE $${paramCount} OR $${paramCount} = ANY(d.keywords))`;
        params.push(`%${search}%`);
        paramCount++;
      }

      if (type) {
        query += ` AND d.type_id = $${paramCount}`;
        params.push(type);
        paramCount++;
      }

      if (fromDate) {
        query += ` AND d.created_at >= $${paramCount}`;
        params.push(new Date(fromDate));
        paramCount++;
      }

      if (toDate) {
        query += ` AND d.created_at <= $${paramCount}`;
        params.push(new Date(toDate));
        paramCount++;
      }

      query += " ORDER BY d.created_at DESC";

      const documents = await pool.query(query, params);
      res.json(documents.rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Obtenir tous les documents par lot
  router.get("/:id/lot", authenticate, async (req, res) => {
    try {
      const { search, type, fromDate, toDate } = req.query;
      const { id } = req.params;

      let query = `
        SELECT d.*, u.username as creator, dt.name as type_name 
        FROM documents d
        LEFT JOIN users u ON d.created_by = u.id
        LEFT JOIN document_types dt ON d.type_id = dt.id
        WHERE 1=1
      `;
      const params = [];
      let paramCount = 1;

      if (search) {
        query += ` AND (d.title ILIKE $${paramCount} OR d.description ILIKE $${paramCount} OR $${paramCount} = ANY(d.keywords))`;
        params.push(`%${search}%`);
        paramCount++;
      }

      if (type) {
        query += ` AND d.type_id = $${paramCount}`;
        params.push(type);
        paramCount++;
      }

      if (fromDate) {
        query += ` AND d.created_at >= $${paramCount}`;
        params.push(new Date(fromDate));
        paramCount++;
      }

      if (toDate) {
        query += ` AND d.created_at <= $${paramCount}`;
        params.push(new Date(toDate));
        paramCount++;
      }

      query += ` AND d.lot_id = ${id} ORDER BY d.created_at DESC`;

      console.log(query);

      const documents = await pool.query(query, params);
      res.json(documents.rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Obtenir un document par ID
  router.get("/:id", authenticate, async (req, res) => {
    try {
      const { id } = req.params;

      const document = await pool.query(
        `SELECT d.*, u.username as creator, dt.name as type_name 
         FROM documents d
         LEFT JOIN users u ON d.created_by = u.id
         LEFT JOIN document_types dt ON d.type_id = dt.id
         WHERE d.id = $1`,
        [id]
      );

      if (document.rows.length === 0) {
        return res.status(404).json({ message: "Document not found" });
      }

      const versions = await pool.query(
        "SELECT * FROM document_versions WHERE document_id = $1 ORDER BY version_number DESC",
        [id]
      );

      res.json({
        ...document.rows[0],
        versions: versions.rows,
      });
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Mettre à jour un document (créer une nouvelle version)
  router.put("/:id/versions", authenticate, async (req, res) => {
    try {
      const { id } = req.params;
      const { changes_description } = req.body;

      if (!req.files || !req.files.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Vérifier si le document existe
      const document = await pool.query(
        "SELECT * FROM documents WHERE id = $1",
        [id]
      );

      if (document.rows.length === 0) {
        return res.status(404).json({ message: "Document not found" });
      }

      const file = req.files.file;
      const fileExt = path.extname(file.name);
      const fileName = `${uuidv4()}${fileExt}`;
      const filePath = path.join(process.env.FILE_UPLOAD_PATH, fileName);

      // Déplacer le fichier vers le dossier uploads
      await file.mv(filePath);

      // Obtenir le prochain numéro de version
      const lastVersion = await pool.query(
        "SELECT MAX(version_number) as max_version FROM document_versions WHERE document_id = $1",
        [id]
      );

      const nextVersion = (lastVersion.rows[0].max_version || 0) + 1;

      // Créer la nouvelle version
      await pool.query(
        `INSERT INTO document_versions (
          document_id, version_number, file_path, created_by, changes_description
        ) VALUES ($1, $2, $3, $4, $5)`,
        [id, nextVersion, fileName, req.user.id, changes_description]
      );

      // Mettre à jour le document principal
      await pool.query(
        `UPDATE documents 
         SET file_path = $1, file_size = $2, file_type = $3, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $4`,
        [fileName, file.size, file.mimetype, id]
      );

      res.json({ message: "New version created successfully" });
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Télécharger un fichier
  router.get("/:id/download", authenticate, async (req, res) => {
    try {
      const { id } = req.params;

      const document = await pool.query(
        "SELECT file_path FROM documents WHERE id = $1",
        [id]
      );

      if (document.rows.length === 0) {
        return res.status(404).json({ message: "Document not found" });
      }

      const filePath = path.join(
        process.env.FILE_UPLOAD_PATH,
        document.rows[0].file_path
      );

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "File not found" });
      }

      res.download(filePath);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Télécharger une version spécifique
  router.get(
    "/:id/versions/:versionId/download",
    authenticate,
    async (req, res) => {
      try {
        const { id, versionId } = req.params;

        const version = await pool.query(
          "SELECT file_path FROM document_versions WHERE id = $1 AND document_id = $2",
          [versionId, id]
        );

        if (version.rows.length === 0) {
          return res.status(404).json({ message: "Version not found" });
        }

        const filePath = path.join(
          process.env.FILE_UPLOAD_PATH,
          version.rows[0].file_path
        );

        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ message: "File not found" });
        }

        res.download(filePath);
      } catch (err) {
        console.error(err.message);
        res.status(500).send("Server error");
      }
    }
  );

  // Ajoutez cette route pour la suppression
  router.delete("/:id", authenticate, async (req, res) => {
    try {
      const { id } = req.params;

      // Vérifier si le document existe
      const document = await pool.query(
        "SELECT * FROM documents WHERE id = $1",
        [id]
      );

      if (document.rows.length === 0) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Journalisation avant suppression
      await pool.query(
        `INSERT INTO user_actions 
       (user_id, action_type, target_id, target_type, details) 
       VALUES ($1, $2, $3, $4, $5)`,
        [
          req.user.id,
          "delete_document",
          id,
          "document",
          `Deleted document: ${document.rows[0].title}`,
        ]
      );

      // Supprimer les versions d'abord
      await pool.query("DELETE FROM document_versions WHERE document_id = $1", [
        id,
      ]);

      // Supprimer le document
      await pool.query("DELETE FROM documents WHERE id = $1", [id]);

      // Optionnel: Supprimer le fichier physique
      const filePath = path.join(
        process.env.FILE_UPLOAD_PATH,
        document.rows[0].file_path
      );

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      res.json({ message: "Document deleted successfully" });
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
