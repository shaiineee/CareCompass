require('dotenv').config();
const supabase = require('./supabase');

(async () => {
  const { data, error } = await supabase.from('tasks').select('*');
  console.log(error || data);
})();