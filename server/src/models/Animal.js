const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

/**
 * Primary table: `animals`.
 * The numeric `id` auto-increments; a human-friendly `tag_number`
 * (e.g. TAG-001-0001) is generated automatically after creation.
 */
const Animal = sequelize.define(
  "Animal",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    tagNumber: {
      type: DataTypes.STRING(32),
      unique: true,
      allowNull: true,
      field: "tag_number",
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    species: {
      type: DataTypes.STRING(60),
      allowNull: false,
      defaultValue: "Dog",
    },
    breed: {
      type: DataTypes.STRING(120),
      allowNull: false,
      defaultValue: "",
    },
    age: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: "",
    },
    gender: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "Female",
    },
    color: {
      type: DataTypes.STRING(120),
      allowNull: false,
      defaultValue: "",
    },
    weight: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: "",
    },
    location: {
      type: DataTypes.STRING(160),
      allowNull: false,
      defaultValue: "",
    },
    marks: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
    },
    status: {
      type: DataTypes.ENUM("safe", "lost", "found"),
      allowNull: false,
      defaultValue: "safe",
    },
    ownerName: {
      type: DataTypes.STRING(120),
      allowNull: false,
      defaultValue: "",
      field: "owner_name",
    },
    ownerEmail: {
      type: DataTypes.STRING(160),
      allowNull: false,
      defaultValue: "",
      field: "owner_email",
    },
    contact: {
      type: DataTypes.STRING(120),
      allowNull: false,
      defaultValue: "",
    },
    vet: {
      type: DataTypes.STRING(160),
      allowNull: false,
      defaultValue: "",
    },
    imageUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "image_url",
    },
    photos: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
    embedding: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    sightings: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    timeline: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
  },
  {
    tableName: "animals",
  },
);

// Auto-generate the formatted tag number from the auto-incremented id.
Animal.addHook("afterCreate", async (animal) => {
  if (!animal.tagNumber) {
    animal.tagNumber = `TAG-001-${String(animal.id).padStart(4, "0")}`;
    await animal.save({ fields: ["tagNumber"] });
    await animal.reload();
  }
});

module.exports = Animal;
