const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const AlertSubscription = sequelize.define(
  "AlertSubscription",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING(160),
      allowNull: false,
      validate: { isEmail: true },
    },
    location: {
      type: DataTypes.STRING(160),
      allowNull: false,
      defaultValue: "",
    },
  },
  {
    tableName: "alert_subscriptions",
  },
);

module.exports = AlertSubscription;
