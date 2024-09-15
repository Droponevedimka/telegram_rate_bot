import fs from 'fs';

const PINNED_MESSAGE_FILE = './statePinnedID.txt';

// Function to save PINNED_MESSAGE_ID and timestamp to a file
export function savePinnedMessageState(state) {
  fs.writeFileSync(PINNED_MESSAGE_FILE, JSON.stringify(state), 'utf8');
}

// Function to load PINNED_MESSAGE_ID and timestamp from the file
export function loadPinnedMessageState() {
  if (fs.existsSync(PINNED_MESSAGE_FILE)) {
    const data = fs.readFileSync(PINNED_MESSAGE_FILE, 'utf8');
    return JSON.parse(data);
  }
  return null;
}

export function isMessageExpired(timestamp) {
  const currentTime = new Date().getTime();
  const timeElapsed = currentTime - timestamp;
  const twentyFourHours = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  return timeElapsed >= twentyFourHours;
}
