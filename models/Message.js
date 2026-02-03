const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
    room: String,
    user: String,
    text: String,
    reactions: {
        type: Map,
        of: Number
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Message", messageSchema);
