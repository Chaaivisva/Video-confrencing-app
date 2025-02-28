require("dotenv").config();
const express = require("express");
const app = express();
const mongoose = require("mongoose");
var amqp = require("amqplib/callback_api");
const { VideoEncodingService } = require("./videoencoder");
const port = process.env.PORT || 8000;

console.log("mongo uri:", process.env.MONGO_URI);
mongoose.connect(process.env.MONGO_URI, {});
const db = mongoose.connection;
let bucket;

db.once("open", () => {
  bucket = new mongoose.mongo.GridFSBucket(db.db);
  console.log("Connected to MongoDB");
});

const listenForEncodingRequests = async () => {
  amqp.connect("amqp://message_queue", function(error0, connection) {
    if (error0) {
      console.log(error0);
      throw error0;
    }
    connection.createChannel(function(error1, channel) {
      if (error1) {
        throw error1;
      }
      var queue = "encode_video_queue";

      channel.assertQueue(queue, {
        durable: false,
      });
      console.log(
        " [*] Waiting for messages in %s. To exit press CTRL+C",
        queue,
      );
      channel.consume(
        queue,
        function(msg) {
          console.log(" [x] Received %s", msg.content.toString());
          console.log(" Started Encoding");
          const videoencodingService = new VideoEncodingService();
          videoencodingService.processVideo(
            JSON.parse(msg.content.toString()).data,
            bucket,
          );
        },
        {
          noAck: true,
        },
      );
    });
  });
};
setTimeout(() => {
  listenForEncodingRequests();
}, 3000);
app.get("/", (req, res) => {
  res.send("Hello World!1");
});

app.listen(port, () => {
  console.log(`Server started on http://localhost:${port}`);
});
