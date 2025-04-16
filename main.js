require("dotenv").config();
const { ethers } = require("ethers");
const readline = require("readline");
const fs = require("fs");
const chalk = require("chalk");

// ====================
// Helper Logging Functions (Gacor & Variatif)
// ====================

// Dapatkan waktu dalam format singkat (HH:MM) dan lengkap (HH:MM:SS)
const getTs = () =>
  new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" });
const getTsFull = () =>
  new Date().toLocaleTimeString([], { hour12: false, second: "2-digit" });

// Fungsi untuk menyingkat alamat (contoh: "0x8whh....wu35")
function shortenAddress(address) {
  if (address.length <= 10) return address;
  return address.slice(0, 6) + "...." + address.slice(-4);
}

// Log info dengan label biru
function logInfo(msg) {
  console.log(chalk.bgBlue.white(" INFO ") + chalk.blue(` | [${getTs()}] » ${msg}`));
}

// Log success dengan label hijau
function logSuccess(msg) {
  console.log(chalk.bgGreen.white(" SUCCESS ") + chalk.green(` | [${getTs()}] » ${msg}`));
}

// Log warning dengan label kuning
function logWarn(msg) {
  console.log(chalk.bgYellow.black(" WARN ") + chalk.yellow(` | [${getTs()}] » ${msg}`));
}

// Log error dengan label merah
function logError(msg) {
  console.error(chalk.bgRed.white(" ERROR ") + chalk.red(` | [${getTs()}] » ${msg}`));
}

// Divider dengan garis panjang
function logDivider() {
  console.log(chalk.gray("════════════════════════════════════════════════════════════════"));
}

// Banner untuk header
function logBanner(title) {
  console.log(chalk.bold.bgMagenta.white(`\n=== ${title.toUpperCase()} ===\n`));
}

// Log singkat untuk transaksi (opsional)
function logTx(msg) {
  console.log(chalk.bgCyan.white(" TX ") + chalk.cyan(` | [${getTs()}] » ${msg}`));
}

// Log detail transaksi secara multiline
function logTransactionDetails(details) {
  logDivider();
  console.log(chalk.whiteBright.bold("Timestamp  : ") + chalk.whiteBright(details.timestamp));
  console.log(chalk.whiteBright.bold("Status     : ") + chalk.whiteBright(`TX ${details.status.toUpperCase()}`));
  console.log(chalk.whiteBright.bold("Tx No.     : ") + chalk.whiteBright(`${details.txNumber}/${details.totalTx}`));
  console.log(chalk.whiteBright.bold("Account    : ") + chalk.whiteBright(details.account));
  console.log(chalk.whiteBright.bold("Recipient  : ") + chalk.whiteBright(shortenAddress(details.recipient)));
  console.log(chalk.whiteBright.bold("Amount     : ") + chalk.whiteBright(`${details.amount} TOKEN`));
  console.log(chalk.whiteBright.bold("Tx Link    : ") + chalk.whiteBright(details.txLink));
  console.log(chalk.whiteBright.bold("Delay      : ") + chalk.whiteBright(`${details.delay} sec`));
  logDivider();
}

// ====================
// Global Configuration
// ====================
let config = {
  accounts: [], // tiap akun: { privateKey, tokenContract, delayMin, delayMax }
  transactionSettings: {
    minTx: 0,      // Minimal transaksi harian per akun
    maxTx: 0,      // Maksimal transaksi harian per akun
    minToken: 0,   // Token MINIMUM yang dikirim (global)
    maxToken: 0    // Token MAXIMUM yang dikirim (global)
  }
};

let RPC_URLS = []; // Endpoint RPC: utama & alternatif

// ====================
// Input Functions
// ====================
const askQuestion = (query) => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.bold.blue(query), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
};

const askMultipleLines = async (promptText, count) => {
  logInfo(promptText);
  const lines = [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.on("line", (input) => {
      lines.push(input.trim());
      if (lines.length === count) rl.close();
    });
    rl.on("close", () => resolve(lines));
  });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ====================
// RPC Provider Functions
// ====================
const getResponsiveProvider = async () => {
  logInfo("Memeriksa koneksi endpoint RPC...");
  for (const url of RPC_URLS) {
    try {
      const provider = new ethers.JsonRpcProvider(url);
      const network = await provider.getNetwork();
      logSuccess(`Terhubung ke RPC: ${url} (Network: ${network.name}, ChainID: ${network.chainId})`);
      return provider;
    } catch (error) {
      logError(`Koneksi RPC gagal: ${url} – ${error.message}`);
    }
  }
  throw new Error("Tidak ada RPC responsif!");
};

let provider = null;
const initializeProvider = async () => {
  try {
    provider = await getResponsiveProvider();
    logInfo("Provider RPC diinisialisasi.");
    logDivider();
  } catch (error) {
    logError(`Inisialisasi provider gagal: ${error.message}`);
    process.exit(1);
  }
};

// ====================
// ERC-20 ABI
// ====================
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

// ====================
// Load Recipient Addresses from File
// ====================
const loadRecipientAddresses = () => {
  try {
    logInfo("Memuat alamat penerima dari 'alamat penerima.txt'...");
    const data = fs.readFileSync("alamat penerima.txt", "utf-8");
    const addresses = data.split(/\r?\n/).map(addr => addr.trim()).filter(addr => addr.length > 0);
    const invalid = addresses.filter(addr => !ethers.isAddress(addr));
    if (invalid.length > 0) {
      logError("Alamat tidak valid:");
      invalid.forEach(addr => logError(`- ${addr}`));
      process.exit(1);
    }
    logSuccess(`Berhasil memuat ${addresses.length} alamat penerima.`);
    logDivider();
    return addresses;
  } catch (error) {
    logError(`Gagal memuat alamat: ${error.message}`);
    process.exit(1);
  }
};

// ====================
// Send Transaction with Retry
// ====================
const sendTransaction = async (privateKey, tokenContract, randomAddress, randomAmount, currentTx, totalTx) => {
  logInfo(`[${currentTx}/${totalTx}] Mengirim ${randomAmount} token ke ${randomAddress}`);
  
  // Attempt 1: RPC utama
  let prov = new ethers.JsonRpcProvider(RPC_URLS[0]);
  let wallet = new ethers.Wallet(privateKey, prov);
  let contract = new ethers.Contract(tokenContract, ERC20_ABI, wallet);
  try {
    let tx = await contract.transfer(randomAddress, ethers.parseUnits(randomAmount.toString()));
    await tx.wait();
    return tx;
  } catch (error1) {
    logWarn(`RPC utama gagal: ${error1.message}`);
  }
  
  // Attempt 2: RPC alternatif, tunggu 10 detik
  logInfo("Mencoba RPC alternatif dalam 10 detik...");
  await sleep(10000);
  prov = new ethers.JsonRpcProvider(RPC_URLS[1]);
  wallet = new ethers.Wallet(privateKey, prov);
  contract = new ethers.Contract(tokenContract, ERC20_ABI, wallet);
  try {
    let tx = await contract.transfer(randomAddress, ethers.parseUnits(randomAmount.toString()));
    await tx.wait();
    return tx;
  } catch (error2) {
    logWarn(`RPC alternatif gagal: ${error2.message}`);
  }
  
  // Attempt 3: Tunggu 2 menit, lalu coba lagi dengan RPC utama
  logInfo("Menunggu 2 menit sebelum mencoba kembali...");
  await sleep(120000);
  prov = new ethers.JsonRpcProvider(RPC_URLS[0]);
  wallet = new ethers.Wallet(privateKey, prov);
  contract = new ethers.Contract(tokenContract, ERC20_ABI, wallet);
  try {
    let tx = await contract.transfer(randomAddress, ethers.parseUnits(randomAmount.toString()));
    await tx.wait();
    return tx;
  } catch (error3) {
    logError(`Tx gagal setelah 3 percobaan: ${error3.message}`);
  }
  return null;
};

// ====================
// Transaction Session per Account
// ====================
const startTransactionSessionForAccount = async (account, accountIndex, addresses) => {
  while (true) {
    // Hitung jumlah transaksi harian secara random untuk akun ini
    const totalTx = Math.floor(Math.random() * (config.transactionSettings.maxTx - config.transactionSettings.minTx + 1)) + config.transactionSettings.minTx;
    logInfo(`Akun ${accountIndex + 1}: Total TX hari ini: ${totalTx}`);
    
    // Variabel untuk menghitung transaksi yang berhasil
    let successCount = 0;
    // Bagi TX ke dalam 4 sesi (20%-10%-50%-20%)
    const session1Count = Math.floor(totalTx * 0.2);
    const session2Count = Math.floor(totalTx * 0.1);
    const session3Count = Math.floor(totalTx * 0.5);
    const session4Count = totalTx - (session1Count + session2Count + session3Count);
    let txCounter = 1;
    
    const walletTemp = new ethers.Wallet(account.privateKey);
    logSuccess(`Mulai sesi untuk Akun ${accountIndex + 1} (${walletTemp.address})`);
    logDivider();
    
    // Fungsi helper untuk menjalankan satu sesi
    const runSession = async (label, count) => {
      logInfo(`>> ${label}: ${count} TX`);
      for (let i = 0; i < count; i++) {
        let randomAddress = addresses[Math.floor(Math.random() * addresses.length)];
        // Hasilkan token amount sebagai bilangan bulat (tanpa desimal)
        let randomAmount = Math.floor(Math.random() * (config.transactionSettings.maxToken - config.transactionSettings.minToken + 1)) + config.transactionSettings.minToken;
        let tx = await sendTransaction(account.privateKey, account.tokenContract, randomAddress, randomAmount, txCounter, totalTx);
        
        // Hitung delay secara acak
        let delaySec = Math.floor(Math.random() * (account.delayMax - account.delayMin) + account.delayMin);
        if (tx) {
          successCount++;
          logSuccess(`Akun ${accountIndex + 1}: Transaksi berhasil ke #${successCount}`);
          logTransactionDetails({
            timestamp: getTsFull(),
            status: "success",
            txNumber: txCounter,
            totalTx: totalTx,
            account: walletTemp.address,
            txLink: "https://sepolia.tea.xyz/tx/" + tx.hash,
            recipient: randomAddress,
            amount: randomAmount,
            delay: delaySec
          });
        }
        txCounter++;
        logInfo(`Akun ${accountIndex + 1}: Tunggu ${delaySec} detik`);
        await sleep(delaySec * 1000);
      }
      logInfo(`<< ${label} SELESAI >>`);
      logDivider();
    };
    
    await runSession("SESI 1", session1Count);
    logInfo("Istirahat 1 jam 5 menit...");
    await sleep(3900000);
    
    await runSession("SESI 2", session2Count);
    logInfo("Istirahat 1 jam 5 menit...");
    await sleep(3900000);
    
    await runSession("SESI 3", session3Count);
    logInfo("Istirahat 1 jam 5 menit...");
    await sleep(3900000);
    
    await runSession("SESI 4", session4Count);
    
    let now = new Date();
    let nextRun = new Date(now);
    nextRun.setDate(now.getDate() + 1);
    nextRun.setHours(7, 30, 0, 0);
    let waitMs = nextRun - now;
    logInfo(`Akun ${accountIndex + 1}: Selesai semua sesi. Tunggu ~${Math.round(waitMs / 60000)} menit hingga 07:30 besok`);
    logDivider();
    await sleep(waitMs);
  }
};

// ====================
// Main Process
// ====================
(async () => {
  logDivider();
  logBanner("Program Dimulai");
  
  // Input Endpoint RPC Global
  logInfo("=== Input Endpoint RPC Global ===");
  const primaryRPC = await askQuestion("Masukkan endpoint RPC UTAMA: ");
  const alternativeRPC = await askQuestion("Masukkan endpoint RPC ALTERNATIF: ");
  if (!primaryRPC.startsWith("http") || !alternativeRPC.startsWith("http")) {
    logError("Endpoint RPC tidak valid. Harap mulai dengan 'http'.");
    process.exit(1);
  }
  RPC_URLS.push(primaryRPC, alternativeRPC);
  logInfo(`RPC UTAMA    : ${primaryRPC}`);
  logInfo(`RPC ALTERNATIF: ${alternativeRPC}`);
  logDivider();
  
  await initializeProvider();
  
  // Input Jumlah Akun
  const numAcc = parseInt(await askQuestion("Masukkan jumlah akun yang akan dijalankan: "));
  if (isNaN(numAcc) || numAcc <= 0) {
    logError("Input jumlah akun tidak valid.");
    process.exit(1);
  }
  logInfo(`Jumlah akun: ${numAcc}`);
  logDivider();
  
  // Input Private Keys
  const pKeys = await askMultipleLines(`Masukkan ${numAcc} Private Key (per baris):`, numAcc);
  logInfo("Private Keys diterima.");
  
  // Input Token Contract Addresses
  const tokenAddrs = await askMultipleLines(`Masukkan ${numAcc} alamat Token Contract ERC-20 (per baris):`, numAcc);
  logInfo("Token Contract Addresses diterima.");
  logDivider();
  
  // Validasi dan input delay tiap akun, simpan ke config.accounts
  for (let i = 0; i < numAcc; i++) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(pKeys[i]) || !ethers.isAddress(tokenAddrs[i])) {
      logError(`Data untuk Akun ${i + 1} tidak valid.`);
      process.exit(1);
    }
    const dMin = parseInt(await askQuestion(`Masukkan delay MINIMUM (detik) untuk Akun ${i + 1}: `));
    const dMax = parseInt(await askQuestion(`Masukkan delay MAXIMUM (detik) untuk Akun ${i + 1}: `));
    if (isNaN(dMin) || isNaN(dMax) || dMin < 0 || dMax < dMin) {
      logError(`Input delay untuk Akun ${i + 1} tidak valid.`);
      process.exit(1);
    }
    config.accounts.push({
      privateKey: pKeys[i],
      tokenContract: tokenAddrs[i],
      delayMin: dMin,
      delayMax: dMax
    });
    logSuccess(`Akun ${i + 1} berhasil ditambahkan.`);
  }
  logDivider();
  
  // Input Pengaturan Transaksi Global (TX & Token)
  logInfo("=== Input Pengaturan Transaksi Global ===");
  const minTx = parseInt(await askQuestion("Masukkan jumlah transaksi MINIMUM harian per akun: "));
  const maxTx = parseInt(await askQuestion("Masukkan jumlah transaksi MAXIMUM harian per akun: "));
  if (isNaN(minTx) || isNaN(maxTx) || minTx <= 0 || maxTx < minTx) {
    logError("Pengaturan TX harian tidak valid.");
    process.exit(1);
  }
  const minToken = parseFloat(await askQuestion("Masukkan jumlah token MINIMUM yang dikirim (global): "));
  const maxToken = parseFloat(await askQuestion("Masukkan jumlah token MAXIMUM yang dikirim (global): "));
  if (isNaN(minToken) || isNaN(maxToken) || minToken < 0 || maxToken < minToken) {
    logError("Pengaturan token tidak valid.");
    process.exit(1);
  }
  config.transactionSettings = { minTx, maxTx, minToken, maxToken };
  logSuccess("Pengaturan transaksi global diterapkan.");
  logDivider();
  
  // Muat Alamat Penerima dari File
  const recipientAddresses = loadRecipientAddresses();
  
  logBanner("Mulai Sesi Transaksi");
  for (let i = 0; i < config.accounts.length; i++) {
    startTransactionSessionForAccount(config.accounts[i], i, recipientAddresses);
  }
})();
