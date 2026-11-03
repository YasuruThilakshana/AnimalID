const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

/**
 * Peer-to-peer owner messaging. One row per message; a conversation (thread)
 * is the set of rows between two users, optionally anchored to a pet
 * (`petId`) when the chat started from a sighting or scan notification.
 * Only the sender and receiver may ever read a row (enforced per query).
 */
const Message = sequelize.define(
  "Message",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    senderId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "sender_id",
    },
    receiverId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "receiver_id",
    },
    petId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
      field: "pet_id",
    },
    text: {
      type: DataTypes.STRING(2000),
      allowNull: false,
      defaultValue: "",
    },
    imageUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      defaultValue: null,
      field: "image_url",
    },
    read: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "messages",
  },
);

module.exports = Message;
