// services/smsService.mock.js
class MockSMSService {
  constructor() {
    this.enabled = true;
  }

  async sendSMS(to, message) {
    console.log("📱 SMS Mock envoyé:", { to, message });
    // Simuler un délai d'envoi
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
      success: true,
      simulated: true,
      messageId: "mock-" + Date.now(),
    };
  }

  isValidPhoneNumber(phoneNumber) {
    return phoneNumber && phoneNumber.length > 5;
  }

  formatPhoneNumber(phoneNumber) {
    return phoneNumber;
  }
}

module.exports = new MockSMSService();
