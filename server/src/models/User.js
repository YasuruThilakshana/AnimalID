const { DataTypes } = require("sequelize");
const bcrypt = require("bcryptjs");
const { sequelize } = require("../config/database");

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(160),
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    passwordHash: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: "password_hash",
    },
  },
  {
    tableName: "users",
    defaultScope: {
      attributes: { exclude: ["passwordHash"] },
    },
  },
);

User.hashPassword = async (password) => bcrypt.hash(password, 10);
User.prototype.checkPassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

module.exports = User;
