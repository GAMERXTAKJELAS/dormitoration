<?php
$host = 'localhost';
$dbname = 'test';
$username = '';
$password = '';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    // Test connection
    echo "✓ Connection successful!";
    
} catch(PDOException $e) {
    echo "✗ Connection failed: " . $e->getMessage();
}
?>