const { Router } = require("express");
const jwt = require("jsonwebtoken");
const smsService = require("../services/smsService");

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

  // Envoyer un message avec notification et SMS
  router.post("/:lotId/messages", authenticate, async (req, res) => {
    const client = await pool.connect();

    try {
      const { lotId } = req.params;
      const { recipientId, subject, content, urgency = "normal" } = req.body;
      const senderId = req.user.id;

      // Validation de l'urgence
      const validUrgencies = ["low", "normal", "medium", "high"];
      if (!validUrgencies.includes(urgency)) {
        return res.status(400).json({
          message: "Niveau d'urgence invalide",
        });
      }

      console.log(
        "📨 Création message - Lot:",
        lotId,
        "De:",
        senderId,
        "Pour:",
        recipientId,
        "Urgence:",
        urgency
      );

      await client.query("BEGIN");

      // 1. Créer le message avec l'urgence
      const messageQuery = `
        INSERT INTO messages (lot_id, sender_id, recipient_id, subject, content, urgency)
        VALUES ($1, $2, $3, $4, $5, $6) 
        RETURNING *
      `;
      const messageResult = await client.query(messageQuery, [
        lotId,
        senderId,
        recipientId,
        subject,
        content,
        urgency,
      ]);

      const newMessage = messageResult.rows[0];

      // 2. Récupérer les informations de l'expéditeur et du destinataire
      const usersQuery = `
        SELECT 
          sender.username as sender_name,
          recipient.username as recipient_name,
          recipient.phone_number as recipient_phone,
          recipient.sms_notifications as recipient_sms_enabled
        FROM users sender, users recipient
        WHERE sender.id = $1 AND recipient.id = $2
      `;
      const usersResult = await client.query(usersQuery, [
        senderId,
        recipientId,
      ]);

      const {
        sender_name,
        recipient_name,
        recipient_phone,
        recipient_sms_enabled,
      } = usersResult.rows[0];

      // 3. Déterminer l'icône et le message selon l'urgence
      const urgencyIcons = {
        low: "📋",
        normal: "📨",
        medium: "⚠️",
        high: "🚨",
      };
      const urgencyLabels = {
        low: "Faible",
        normal: "Normal",
        medium: "Moyen",
        high: "Urgent",
      };

      const icon = urgencyIcons[urgency] || "📨";
      const urgencyLabel = urgencyLabels[urgency] || "Normal";

      // 4. Créer la notification interne
      const notificationQuery = `
        INSERT INTO notifications (lot_id, user_id, type, message, urgency, related_message_id)
        VALUES ($1, $2, $3, $4, $5, $6) 
        RETURNING *
      `;

      const notificationMessage = `${icon} [${urgencyLabel}] Message de ${sender_name}: "${subject.substring(
        0,
        50
      )}${subject.length > 50 ? "..." : ""}"`;

      const notificationResult = await client.query(notificationQuery, [
        lotId,
        recipientId,
        "message",
        notificationMessage,
        urgency,
        newMessage.id,
      ]);

      console.log(
        "🔔 Notification interne créée:",
        notificationResult.rows[0].id
      );

      // 5. Envoyer une notification SMS si configuré
      let smsResult = null;
      if (
        recipient_sms_enabled &&
        recipient_phone &&
        smsService.isValidPhoneNumber(recipient_phone)
      ) {
        const smsMessage = `[Lot ${lotId}] ${icon} Message de ${sender_name}: ${subject.substring(
          0,
          60
        )}${subject.length > 60 ? "..." : ""}`;

        smsResult = await smsService.sendSMS(
          smsService.formatPhoneNumber(recipient_phone),
          smsMessage
        );

        // Enregistrer l'envoi SMS dans les logs
        await client.query(
          `INSERT INTO sms_logs (user_id, message_id, phone_number, message, status) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            recipientId,
            newMessage.id,
            recipient_phone,
            smsMessage,
            smsResult.success ? "sent" : "failed",
          ]
        );
      }

      await client.query("COMMIT");

      res.status(201).json({
        message: newMessage,
        notification: notificationResult.rows[0],
        sms: smsResult,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("❌ Erreur création message:", err.message);
      res.status(500).json({
        message: "Erreur lors de la création du message",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    } finally {
      client.release();
    }
  });

  // Envoyer une notification
  router.post("/:lotId/notifications", authenticate, async (req, res) => {
    try {
      const { lotId } = req.params;
      const { userId, type, message, urgency } = req.body;

      const newNotification = await pool.query(
        `INSERT INTO notifications (
          lot_id, user_id, type, message, urgency
        ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [lotId, userId, type, message, urgency]
      );

      res.status(201).json(newNotification.rows[0]);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // Obtenir les messages avec l'urgence
  router.get("/:lotId/messages", authenticate, async (req, res) => {
    try {
      const { lotId } = req.params;
      const { userId } = req.query;

      let query = `
        SELECT 
          m.*,
          u1.username as sender_name,
          u2.username as recipient_name,
          EXISTS (
            SELECT 1 FROM notifications n 
            WHERE n.related_message_id = m.id AND n.user_id = $2 AND n.read = false
          ) as has_unread_notification
        FROM messages m
        JOIN users u1 ON m.sender_id = u1.id
        LEFT JOIN users u2 ON m.recipient_id = u2.id
        WHERE m.lot_id = $1
      `;

      const params = [lotId, req.user.id];

      if (userId) {
        query += ` AND (m.recipient_id = $3 OR m.sender_id = $3)`;
        params.push(userId);
      }

      query += ` ORDER BY 
        CASE urgency 
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END, 
        m.created_at DESC`;

      const messages = await pool.query(query, params);
      res.json(messages.rows);
    } catch (err) {
      console.error("❌ Erreur récupération messages:", err.message);
      res.status(500).json({
        message: "Erreur lors de la récupération des messages",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  });

  // Obtenir les notifications avec les informations des messages liés
  router.get("/:lotId/notifications", authenticate, async (req, res) => {
    try {
      const { lotId } = req.params;
      const { userId, unreadOnly } = req.query;

      let query = `
        SELECT 
          n.*,
          u.username as user_name,
          m.subject as related_message_subject,
          m.sender_id as related_message_sender_id,
          sender.username as related_message_sender_name
        FROM notifications n
        LEFT JOIN users u ON n.user_id = u.id
        LEFT JOIN messages m ON n.related_message_id = m.id
        LEFT JOIN users sender ON m.sender_id = sender.id
        WHERE n.lot_id = $1 AND n.user_id = $2
      `;

      const params = [lotId, req.user.id];

      if (unreadOnly === "true") {
        query += ` AND n.read = FALSE`;
      }

      query += " ORDER BY n.created_at DESC";

      const result = await pool.query(query, params);

      res.json(result.rows);
    } catch (err) {
      console.error("❌ Erreur récupération notifications:", err.message);
      res.status(500).json({
        message: "Erreur lors de la récupération des notifications",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  });

  // Marquer une notification comme lue
  router.patch("/notifications/:id/read", authenticate, async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `UPDATE notifications 
         SET read = TRUE, read_at = CURRENT_TIMESTAMP 
         WHERE id = $1 AND user_id = $2 
         RETURNING *`,
        [id, req.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Notification non trouvée" });
      }

      res.json({
        message: "Notification marquée comme lue",
        notification: result.rows[0],
      });
    } catch (err) {
      console.error("❌ Erreur mise à jour notification:", err.message);
      res.status(500).json({
        message: "Erreur lors de la mise à jour de la notification",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  });

  return router;
};
