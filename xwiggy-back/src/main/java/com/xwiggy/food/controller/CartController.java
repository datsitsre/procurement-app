package com.xwiggy.food.controller;

import com.xwiggy.food.dao.CartService;
import com.xwiggy.food.model.Food;
import com.xwiggy.food.model.OrderLineRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.NoSuchElementException;

/** Merchant-side inventory management. The customer cart/checkout flow lives in OrderController. */
@RestController
public class CartController {

    @Autowired
    CartService cartDao;

    @PostMapping("/addToCart")
    public ResponseEntity<?> increaseQuantity(@RequestBody List<OrderLineRequest> items){
        try {
            return ResponseEntity.ok(cartDao.addItems(items));
        } catch (NoSuchElementException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.unprocessableEntity().body(e.getMessage());
        }
    }

    @PostMapping("/addNewItem")
    public ResponseEntity<?> addNewItem(@RequestParam("file") MultipartFile file, @RequestParam("newFoodItem") String newFoodData) throws IOException {
        try {
            return ResponseEntity.ok(cartDao.addNewItem(file,newFoodData));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(e.getMessage());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.unprocessableEntity().body(e.getMessage());
        }
    }


    @PostMapping("/addNewItemUrl")
    public ResponseEntity<?> addNewItemByUrl(@RequestParam("newFoodItem") String newFoodData) throws IOException {
        try {
            return ResponseEntity.ok(cartDao.addNewItemWithUrl(newFoodData));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(e.getMessage());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.unprocessableEntity().body(e.getMessage());
        }
    }

    @PostMapping("/checkItemId")
    public boolean checkItemId(@RequestBody String itemId){
        return !cartDao.itemIdAvailable(itemId);
    }
}
