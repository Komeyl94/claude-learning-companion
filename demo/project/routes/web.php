<?php

use App\Models\User;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => view('welcome'));
