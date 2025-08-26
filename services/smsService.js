const twilio = require("twilio");
const Vonage = require("@vonage/server-sdk");

class SMSService {
  constructor() {
    this.provider = process.env.SMS_PROVIDER;
    this.enabled = process.env.SMS_ENABLED === "true";

    this.initializeProvider();
  }

  initializeProvider() {
    if (!this.enabled) return;

    switch (this.provider) {
      case "twilio":
        this.client = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );
        break;

      case "vonage":
        this.client = new Vonage({
          apiKey: process.env.VONAGE_API_KEY,
          apiSecret: process.env.VONAGE_API_SECRET,
        });
        break;

      default:
        console.warn("⚠️  Aucun provider SMS configuré");
        this.enabled = false;
    }
  }

  async sendSMS(to, message) {
    if (!this.enabled) {
      console.log("📱 SMS désactivé (simulation):", { to, message });
      return { success: true, simulated: true };
    }

    try {
      let result;

      switch (this.provider) {
        case "twilio":
          result = await this.client.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: to,
          });
          break;

        case "vonage":
          result = await new Promise((resolve, reject) => {
            this.client.sms.send(
              process.env.VONAGE_FROM_NUMBER,
              to,
              message,
              (err, response) => {
                if (err) reject(err);
                else resolve(response);
              }
            );
          });
          break;
      }

      console.log("✅ SMS envoyé avec succès:", {
        to,
        messageId: result.sid || result.messageId,
      });
      return { success: true, data: result };
    } catch (error) {
      console.error("❌ Erreur envoi SMS:", error.message);
      return { success: false, error: error.message };
    }
  }

  // Formater le numéro de téléphone
  formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;

    // Supprimer tous les caractères non numériques
    let cleaned = phoneNumber.replace(/\D/g, "");

    // Ajouter l'indicatif international si absent
    if (cleaned.startsWith("0")) {
      cleaned = "33" + cleaned.substring(1); // France par défaut
    }

    return "+" + cleaned;
  }

  // Vérifier si un numéro est valide
  isValidPhoneNumber(phoneNumber) {
    if (!phoneNumber) return false;
    const cleaned = phoneNumber.replace(/\D/g, "");
    return cleaned.length >= 10; // Au moins 10 chiffres
  }
}

module.exports = new SMSService();
