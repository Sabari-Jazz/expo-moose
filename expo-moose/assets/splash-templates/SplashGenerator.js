/**
 * This is a utility script to generate a beautiful splash screen
 * You would run this with: node SplashGenerator.js
 * It requires canvas and fs packages: npm install canvas fs
 */

const fs = require("fs");
const { createCanvas, loadImage } = require("canvas");

// Create a canvas for the splash screen (1242x2436 is good for all devices)
const width = 1242;
const height = 2436;
const canvas = createCanvas(width, height);
const ctx = canvas.getContext("2d");

// Fill the background with a nice gradient
const gradient = ctx.createLinearGradient(0, 0, 0, height);
gradient.addColorStop(0, "#0066CC"); // Top color - primary blue
gradient.addColorStop(1, "#004999"); // Bottom color - darker blue
ctx.fillStyle = gradient;
ctx.fillRect(0, 0, width, height);

// Add a nice pattern to the background (optional)
async function drawSplash() {
  // Draw solar-like patters in the background
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const radius = Math.random() * 400 + 100;

    const circleGradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    circleGradient.addColorStop(0, "#FFFFFF");
    circleGradient.addColorStop(1, "transparent");

    ctx.fillStyle = circleGradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Draw floating particles
  ctx.fillStyle = "#FFFFFF";
  for (let i = 0; i < 50; i++) {
    const size = Math.random() * 4 + 1;
    const x = Math.random() * width;
    const y = Math.random() * height;
    ctx.globalAlpha = Math.random() * 0.4 + 0.1;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = a1;

  // Load and draw the logo
  try {
    // Make sure your logo is in the right location or update this path
    const logo = await loadImage("../icon.png");

    // Calculate logo size and position (centered)
    const logoSize = Math.min(width, height) * 0.3; // 30% of smallest dimension
    const logoX = (width - logoSize) / 2;
    const logoY = height * 0.4 - logoSize / 2; // Positioned slightly above center

    // Draw the logo
    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);

    // Add app name below logo
    ctx.font = "bold 60px Arial";
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.fillText("Moose", width / 2, height * 0.4 + logoSize + 80);

    // Add tagline
    ctx.font = "30px Arial";
    ctx.fillText(
      "Solar Monitoring System",
      width / 2,
      height * 0.4 + logoSize + 130
    );

    // Export the splash screen to a PNG file
    const buffer = canvas.toBuffer("image/png");
    fs.writeFileSync("../splash.png", buffer);

    console.log("Splash screen generated successfully!");
  } catch (error) {
    console.error("Error generating splash screen:", error);
  }
}

drawSplash();
