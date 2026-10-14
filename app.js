require('dotenv').config();
const express = require('express');
const app = express();

// supabase connect
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', async (req, res) => {
  const { data: tasks, error } = await supabase
    .from('tasks').select('*').eq('user_id', 1);
  if (error) { console.log(error); return res.status(500).send('Database error'); }
  console.log(tasks);   // temporary, to check the database in the terminal
  res.render('index', { name: 'Mary', tasks });
});

app.listen(3000, () => console.log('Running on http://localhost:3000'));