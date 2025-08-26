const { Router } = require("express");
const jwt = require("jsonwebtoken");

module.exports = (pool) => {
  const router = Router();

  const authenticate = (req, res, next) => {
    const token = req.header("x-auth-token");
    if (!token)
      return res
        .status(401)
        .json({ message: "No token, authorization denied" });

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ message: "Token is not valid" });
    }
  };

  // Planifier une réunion
  router.post("/:lotId", authenticate, async (req, res) => {
    try {
      const { lotId } = req.params;
      const { title, date, time, location, participants, agenda } = req.body;

      const newMeeting = await pool.query(
        `INSERT INTO meetings (
          lot_id, title, date, time, location, participants, agenda, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [lotId, title, date, time, location, participants, agenda, req.user.id]
      );

      res.status(201).json(newMeeting.rows[0]);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Mettre à jour une réunion
  router.put("/:meetingId", authenticate, async (req, res) => {
    try {
      const { meetingId } = req.params;
      const { title, date, time, location, participants, agenda } = req.body;

      // Vérifier si la réunion existe
      const meetingCheck = await pool.query(
        "SELECT * FROM meetings WHERE id = $1",
        [meetingId]
      );

      if (meetingCheck.rows.length === 0) {
        return res.status(404).json({ message: "Réunion non trouvée" });
      }

      const updatedMeeting = await pool.query(
        `UPDATE meetings 
         SET title = $1, date = $2, time = $3, location = $4, 
             participants = $5, agenda = $6, updated_at = CURRENT_TIMESTAMP
         WHERE id = $7 RETURNING *`,
        [title, date, time, location, participants, agenda, meetingId]
      );

      res.json(updatedMeeting.rows[0]);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Supprimer une réunion
  router.delete("/:meetingId", authenticate, async (req, res) => {
    try {
      const { meetingId } = req.params;

      // Vérifier si la réunion existe
      const meetingCheck = await pool.query(
        "SELECT * FROM meetings WHERE id = $1",
        [meetingId]
      );

      if (meetingCheck.rows.length === 0) {
        return res.status(404).json({ message: "Réunion non trouvée" });
      }

      // Supprimer d'abord le PV associé s'il existe
      await pool.query("DELETE FROM meeting_minutes WHERE meeting_id = $1", [
        meetingId,
      ]);

      // Supprimer la réunion
      await pool.query("DELETE FROM meetings WHERE id = $1", [meetingId]);

      res.json({ message: "Réunion supprimée avec succès" });
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Obtenir les détails d'une réunion spécifique
  router.get("/meeting/:meetingId", authenticate, async (req, res) => {
    try {
      const { meetingId } = req.params;

      const meeting = await pool.query(
        `SELECT m.*, u.username as creator,
                mm.content as pv_content, mm.decisions as pv_decisions, 
                mm.next_steps as pv_next_steps, mm.created_at as pv_created_at,
                mm.updated_at as pv_updated_at
         FROM meetings m
         LEFT JOIN users u ON m.created_by = u.id
         LEFT JOIN meeting_minutes mm ON m.id = mm.meeting_id
         WHERE m.id = $1`,
        [meetingId]
      );

      if (meeting.rows.length === 0) {
        return res.status(404).json({ message: "Réunion non trouvée" });
      }

      const meetingData = meeting.rows[0];
      const result = {
        ...meetingData,
        has_minutes: !!meetingData.pv_content,
        pv: meetingData.pv_content
          ? {
              content: meetingData.pv_content,
              decisions: meetingData.pv_decisions,
              next_steps: meetingData.pv_next_steps,
              created_at: meetingData.pv_created_at,
              updated_at: meetingData.pv_updated_at,
            }
          : null,
      };

      res.json(result);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Obtenir les réunions d'un lot
  router.get("/:lotId", authenticate, async (req, res) => {
    try {
      const { lotId } = req.params;
      const { upcomingOnly } = req.query;

      let query = `SELECT m.*, u.username as creator, 
                  (SELECT COUNT(*) FROM meeting_minutes WHERE meeting_id = m.id) > 0 as has_minutes,
                  mm.created_at as pv_created_at
                  FROM meetings m
                  JOIN users u ON m.created_by = u.id
                  LEFT JOIN meeting_minutes mm ON m.id = mm.meeting_id
                  WHERE m.lot_id = $1`;

      const params = [lotId];

      if (upcomingOnly === "true") {
        query += ` AND m.date >= CURRENT_DATE`;
      }

      query += " ORDER BY m.date, m.time";

      const meetings = await pool.query(query, params);
      res.json(meetings.rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Envoyer les invitations
  router.post(
    "/:meetingId/send-invitations",
    authenticate,
    async (req, res) => {
      try {
        const { meetingId } = req.params;

        await pool.query(
          "UPDATE meetings SET invitations_sent = TRUE WHERE id = $1",
          [meetingId]
        );

        res.json({ message: "Invitations envoyées avec succès" });
      } catch (err) {
        console.error(err.message);
        res.status(500).send("Server error");
      }
    }
  );

  // Créer un PV de réunion
  router.post("/:meetingId/pv", authenticate, async (req, res) => {
    try {
      const { meetingId } = req.params;
      const { content, decisions, next_steps } = req.body;

      // Vérifier que la réunion existe
      const meeting = await pool.query(
        "SELECT id FROM meetings WHERE id = $1",
        [meetingId]
      );

      if (meeting.rows.length === 0) {
        return res.status(404).json({ message: "Réunion non trouvée" });
      }

      // Vérifier si un PV existe déjà
      const existingPV = await pool.query(
        "SELECT id FROM meeting_minutes WHERE meeting_id = $1",
        [meetingId]
      );

      if (existingPV.rows.length > 0) {
        return res
          .status(400)
          .json({ message: "Un PV existe déjà pour cette réunion" });
      }

      // Créer le PV
      const result = await pool.query(
        `INSERT INTO meeting_minutes (
        meeting_id, 
        content, 
        decisions, 
        next_steps,
        created_by
      ) VALUES ($1, $2, $3, $4, $5) 
      RETURNING *`,
        [meetingId, content, decisions, next_steps, req.user.id]
      );

      // Mettre à jour le statut has_minutes dans la table meetings
      await pool.query("UPDATE meetings SET has_minutes = TRUE WHERE id = $1", [
        meetingId,
      ]);

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Mettre à jour un PV de réunion
  router.put("/:meetingId/pv", authenticate, async (req, res) => {
    try {
      const { meetingId } = req.params;
      const { content, decisions, next_steps } = req.body;

      // Vérifier que le PV existe
      const pvCheck = await pool.query(
        "SELECT id FROM meeting_minutes WHERE meeting_id = $1",
        [meetingId]
      );

      if (pvCheck.rows.length === 0) {
        return res.status(404).json({ message: "PV non trouvé" });
      }

      // Mettre à jour le PV
      const result = await pool.query(
        `UPDATE meeting_minutes 
       SET content = $1, decisions = $2, next_steps = $3, 
           updated_at = CURRENT_TIMESTAMP
       WHERE meeting_id = $4 
       RETURNING *`,
        [content, decisions, next_steps, meetingId]
      );

      // S'assurer que le statut has_minutes est à TRUE
      await pool.query("UPDATE meetings SET has_minutes = TRUE WHERE id = $1", [
        meetingId,
      ]);

      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Obtenir un PV de réunion
  router.get("/:meetingId/pv", authenticate, async (req, res) => {
    try {
      const { meetingId } = req.params;

      const pv = await pool.query(
        `SELECT mm.*, u.username as creator_name, m.title as meeting_title
         FROM meeting_minutes mm
         JOIN meetings m ON mm.meeting_id = m.id
         JOIN users u ON mm.created_by = u.id
         WHERE mm.meeting_id = $1`,
        [meetingId]
      );

      if (pv.rows.length === 0) {
        return res.status(404).json({ message: "PV non trouvé" });
      }

      res.json(pv.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Supprimer un PV de réunion
  router.delete("/:meetingId/pv", authenticate, async (req, res) => {
    try {
      const { meetingId } = req.params;

      const result = await pool.query(
        "DELETE FROM meeting_minutes WHERE meeting_id = $1 RETURNING *",
        [meetingId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "PV non trouvé" });
      }

      // Mettre à jour le statut has_minutes dans la table meetings
      await pool.query(
        "UPDATE meetings SET has_minutes = FALSE WHERE id = $1",
        [meetingId]
      );

      res.json({ message: "PV supprimé avec succès" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  // Récupérer les participants habituels
  router.get("/:lotId/usual-participants", authenticate, async (req, res) => {
    try {
      const { lotId } = req.params;
      const result = await pool.query(
        "SELECT * FROM usual_meeting_participants WHERE lot_id = $1",
        [lotId]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).send("Server error");
    }
  });

  // Ajouter un participant habituel
  router.post("/:lotId/usual-participants", authenticate, async (req, res) => {
    try {
      const { lotId } = req.params;
      const { email, name, role } = req.body;

      const result = await pool.query(
        `INSERT INTO usual_meeting_participants 
       (lot_id, email, name, role) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
        [lotId, email, name, role]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).send("Server error");
    }
  });

  // Supprimer un participant habituel
  router.delete(
    "/usual-participants/:participantId",
    authenticate,
    async (req, res) => {
      try {
        const { participantId } = req.params;

        const result = await pool.query(
          "DELETE FROM usual_meeting_participants WHERE id = $1 RETURNING *",
          [participantId]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ message: "Participant non trouvé" });
        }

        res.json({ message: "Participant supprimé avec succès" });
      } catch (err) {
        res.status(500).send("Server error");
      }
    }
  );

  return router;
};
