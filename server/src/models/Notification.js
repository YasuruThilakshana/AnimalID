const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

/**
 * Owner-routed notifications. The scanner creates a `found_scan` row when a
 * public photo scan returns a confident 100% verified match for a pet whose
 * status is "lost"; the owner reads it via the notification bell and Ash Chat.
 */
const Notification = sequelize.define(
  "Notification",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    ownerEmail: {
      type: DataTypes.STRING(160),
      allowNull: false,
      defaultValue: "",
      field: "owner_email",
    },
    petId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: "pet_id",
    },
    petName: {
      type: DataTypes.STRING(120),
      allowNull: false,
      defaultValue: "",
      field: "pet_name",
    },
    type: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: "found_scan",
    },
    title: {
      type: DataTypes.STRING(160),
      allowNull: false,
      defaultValue: "",
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
    },
    location: {
      type: DataTypes.STRING(160),
      allowNull: false,
      defaultValue: "",
    },
    scannerUserId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
      field: "scanner_user_id",
    },
    scannerName: {
      type: DataTypes.STRING(120),
      allowNull: false,
      defaultValue: "",
      field: "scanner_name",
    },
    scannerContact: {
      type: DataTypes.STRING(160),
      allowNull: false,
      defaultValue: "",
      field: "scanner_contact",
    },
    read: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "notifications",
  },
);

module.exports = Notification;
