// Strict Mode
'use strict';

// Imports
import express, { json } from 'express';
import helmet from "helmet";
import NodeCache from 'node-cache';
import { registerFont, createCanvas } from 'canvas';
import Chart from 'chart.js/auto';
import axios from 'axios';
import dayjs from 'dayjs';
import * as emoji from 'node-emoji'
import 'chartjs-adapter-dayjs-4/dist/chartjs-adapter-dayjs-4.esm.js';

registerFont('./fonts/JetBrainsMono-Regular.ttf', { family: 'JetBrains Mono Regular' })
registerFont('./fonts/JetBrainsMono-Bold.ttf', { family: 'JetBrains Mono Bold' })

// Start express plus a security mesure
const app = express().disable("x-powered-by");
app.use(json());
app.use(helmet());

// URL of the server we're creating
const API_URL = `http://localhost:${process.env.PORT}`

// Width of canvas in px
const WIDTH = 495;

// Height of canvas in px
const HEIGHT = 195;

// Color Palette
const colorPalette = {
  red: {
    line: 'rgba(201, 25, 0, 1)',
    area: 'rgba(201, 25, 0, 0.25)',
    title: 'rgba(201, 25, 0, 0.80)',
    xlabel: 'rgba(201, 25, 0, 0.80)'
  },
  orange: {
    line: 'rgba(255, 137, 0, 1)',
    area: 'rgba(255, 137, 0, 0.25)',
    title: 'rgba(255, 137, 0, 0.80)',
    xlabel: 'rgba(255, 137, 0, 0.80)'
  },
  yellow: {
    line: 'rgba(255, 215, 0, 1)',
    area: 'rgba(255, 215, 0, 0.25)',
    title: 'rgba(255, 215, 0, 0.80)',
    xlabel: 'rgba(255, 215, 0, 0.80)'
  },
  green: {
    line: 'rgba(32, 212, 32, 1)',
    area: 'rgba(32, 212, 32, 0.25)',
    title: 'rgba(32, 212, 32, 0.80)',
    xlabel: 'rgba(32, 212, 32, 0.80)'
  },
  blue: {
    line: 'rgba(30, 78, 255, 1)',
    area: 'rgba(30, 78, 255, 0.25)',
    title: 'rgba(30, 78, 255, 0.80)',
    xlabel: 'rgba(30, 78, 255, 0.80)'
  },
  violet: {
    line: 'rgba(150, 0, 215, 1)',
    area: 'rgba(150, 0, 215, 0.25)',
    title: 'rgba(150, 0, 215, 0.80)',
    xlabel: 'rgba(150, 0, 215, 0.80)'
  },
};

// Redirect HTTP to HTTPS (Made for Heroku Deployment) -- COMMENT THIS IF YOU'RE NOT USING HTTPS
app.use((req, res, next) => {
  if (req.header('x-forwarded-proto') !== 'https') {
    res.redirect(`https://${req.hostname}${req.url}`);
  } else {
    next();
  }
});


// Initialize cache (set default TTL to 24 hours = 86400 seconds)
const cache = new NodeCache({ stdTTL: 86400, checkperiod: 600 }); // Check for expired keys every 10 minutes


// Define the GET call to /chart
app.get('/chart', async (req, res) => {

  // Logging
  console.log("GET " + req.hostname + req.url);

  // Get these parameters from the url
  // Format (optional) -> localhost:3000/chart?username=username&repository=repository (&color=color)
  const { username, repository, color } = req.query;

  if (!username || !repository) {
    return res.status(400).send('Username and repository are required');
  }

  // Unique cache key based on query parameters
  const cacheKey = `${username}-${repository}-${color}`;
  // Github API endpoint
  const GITHUB_API_URL = `https://api.github.com/repos/${username}/${repository}`;

  // Check if the chart is already cached
  const cachedImage = cache.get(cacheKey);
  if (cachedImage) {
    // Cache hit
    res.header({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400'
    });
    return res.send(Buffer.from(cachedImage.split(',')[1], 'base64'));
  }

  // If not cached, generate the chart image (cache miss)
  try {
    const chartImage = await createChartImage(`https://api.github.com/repos/${username}/${repository}`, color);

    // Cache the generated image
    cache.set(cacheKey, chartImage);

    // Send the response with caching headers
    res.header({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400'
    });
    res.send(Buffer.from(chartImage.split(',')[1], 'base64'));
  } catch (error) {
    console.error(error);
    res.status(500).send('Error creating chart image');
  }
});

// Main function to create the Chart using Chartjs
const createChartImage = async (GITHUB_API_URL, color = "violet") => {

  // Fetch Repository info
  const repoInfo = await axios.get(GITHUB_API_URL);

  // Check if the repository exists
  if (repoInfo.status !== 200) {
    throw new Error(`Unable to fetch repository information. Status code: ${repoInfo.status}`);
  }

  const totalStars = repoInfo.data.stargazers_count;
  const url = `${GITHUB_API_URL}/stargazers?per_page=100`;
  const pageCount = Math.ceil(totalStars / 100);

  // Fetch user-starred history
  const starsHistory = await getStarsHistory(url, pageCount);

  // Map for storing dates and stars count
  const dateMap = new Map();
  let cumulativeCount = 0;

  // Sort by date
  starsHistory.sort((a, b) => dayjs(a.starred_at).isBefore(dayjs(b.starred_at), "day"));

  // Store dates and stars count
  starsHistory.forEach(entry => {
    const key = dayjs(entry.starred_at).format('YYYY-MM-DD').toString();
    cumulativeCount += 1;
    dateMap.set(key, cumulativeCount);
  });

  // X Chart axes
  const labels = [];

  // Y Chart axes
  const cumulativeStars = [];

  // Fill X-axes and Y-axes
  const dataArray = Array.from(dateMap.entries())
  dataArray.forEach(([key, count]) => {
    labels.push(key);
    cumulativeStars.push(count);
  });

  // Comparing by day, if the repo has been created in a date before the day the first user starred it
  if (dayjs(repoInfo.data.created_at).isBefore(dayjs(dataArray[0][0]).format("YYYY-MM-DD"), "day")) {

    let date = dayjs(repoInfo.data.created_at);
    const endDate = dayjs(dataArray[0][0]).format("YYYY-MM-DD");

    while (date.isBefore(endDate)) {
      // Then We show as first x-label the day of the creation of the repo and all the dates between repo creation date
      // and the date in which the first user starred the repo
      labels.unshift(date.format('YYYY-MM-DD'));
      cumulativeStars.unshift(0);
      date = date.add(1, 'day');
    }
  }

  // Comparing by day, if the repo has not been starred today
  if (dayjs(dataArray[dataArray.length - 1][0]).isBefore(dayjs().format("YYYY-MM-DD"), "day")) {
    // Then We add the last label with today-date
    labels.push(dayjs().format('YYYY-MM-DD'));
    // And as value we use the last amount of stars known
    cumulativeStars.push(dataArray[dataArray.length - 1][1]);
  }

  // Find the index of the last zero to keep
  const lastZeroIndex = cumulativeStars.lastIndexOf(0);

  // Replace all values before the last zero with null
  const filteredStars = cumulativeStars.map((value, index) =>
    index < lastZeroIndex ? null : value
  );
  // In order to create rounded corner around the canvas and fill it with black
  const colorArea = {
    id: 'colorArea',
    beforeDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(0, 0, 495, 195, 15);
      ctx.fillStyle = 'black';
      ctx.fill();
    }
  }

  // Count how many different months there are in the array provided
  function countUniqueMonths(x) {
    const months = x.map(value => dayjs(value).format('YYYY-MM'));
    return new Set(months).size;
  }

  // Exact number of X labels to show
  let uniqueMonths = countUniqueMonths(labels);
  let xLabelsToShow = 6;
  if (uniqueMonths <= 2) {
    xLabelsToShow = 2;
  } else if (uniqueMonths === 3) {
    xLabelsToShow = 3;
  } else if (uniqueMonths === 4) {
    xLabelsToShow = 4;
  } else if (uniqueMonths === 5) {
    xLabelsToShow = 5;
  }

  // Maximum number of Y labels to show
  let maxYLabelsToShow = 4;
  if (cumulativeStars.length <= 2)
    maxYLabelsToShow = 2;
  else if (cumulativeStars.length === 3)
    maxYLabelsToShow = 3;

  // Chart configuration
  const configuration = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        data: filteredStars,
        fill: true,
        borderColor: colorPalette[color].line,
        backgroundColor: colorPalette[color].area,
        tension: 0.4,
        borderWidth: 4,
        pointRadius: 0
      }]
    },
    options: {
      plugins: {
        legend: {
          display: false
        },
        title: {
          display: true,
          text: "Star History - " + repoInfo.data.full_name,
          color: colorPalette[color].title,
          font: {
            family: 'JetBrains Mono Bold',
            size: 16,
          },
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'day',
          },
          position: 'bottom',
          grid: {
            display: false
          },
          ticks: {
            autoSkip: true,
            align: 'inner',
            color: colorPalette[color].xlabel,
            font: {
              family: 'JetBrains Mono Bold',
              size: 24,
            },
            callback: function (value, index, values) {
              // Determine the step between each label
              let step = Math.floor(values.length / (xLabelsToShow - 1));

              // Always show the first and last label (last label will show a zap icon)
              if (index === 0 || index === values.length - 1) {
                let formattedDate = dayjs(value).format('MMM').charAt(0) + dayjs(value).format('YY');
                return index === values.length - 1 ? emoji.get("zap") : formattedDate;
              }

              // For other labels, return null (do not show them) if they're not a multiple of the step size
              else if (index % step !== 0 || index > values.length - 1 - step / 2) {
                return null;
              }

              // Calculate the formatted date only when necessary
              let formattedDate = dayjs(value).format('MMM').charAt(0) + dayjs(value).format('YY');
              return formattedDate;
            }
          }
        },
        y: {
          min: 0,
          grid: {
            display: false
          },
          ticks: {
            beginAtZero: true,
            autoSkip: true,
            maxTicksLimit: maxYLabelsToShow,
            align: 'center',
            color: 'rgba(255, 255, 255, 0.95)',
            font: {
              family: 'JetBrains Mono Regular',
              size: 18,
            },
          }
        }
      },
      layout: {
        padding: {
          left: 10,
          bottom: 2,
          right: 4,
        }
      }
    },
    plugins: [colorArea]
  };

  // Create a canvas with the desidered dimensions
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Draw the chart
  new Chart(ctx, configuration);

  // Convert canvas to data URL
  const dataUrl = canvas.toDataURL();
  return dataUrl;
};

// Recursive function to fetch stars history being aware of github pagination limits
const getStarsHistory = async (url, pageCount, page = 1, starsHistory = []) => {
  const headers = {
    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3.star+json'
  };
  const response = await axios.get(`${url}&page=${page}`, { headers });
  starsHistory = starsHistory.concat(response.data);

  if (page < pageCount) {
    return getStarsHistory(url, pageCount, page + 1, starsHistory);
  } else {
    return starsHistory;
  }
};

app.listen(process.env.PORT, () => {
  console.log(`Server is running at ${API_URL}/chart`);
});