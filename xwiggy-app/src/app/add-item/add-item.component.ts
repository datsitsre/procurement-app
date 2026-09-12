import { Component, OnInit } from '@angular/core';
import {environment} from "../../environments/environment";
import {HttpClient} from "@angular/common/http";
import {Router} from "@angular/router";

@Component({
  standalone: false,
  selector: 'app-add-item',
  templateUrl: './add-item.component.html',
  styleUrls: ['./add-item.component.css']
})
export class AddItemComponent implements OnInit {


  newFoodItems:foodItems={
    id:'',
    name:'',
    price:null,
    quantityAvailable:null,
    fileDataF:null,
    category:null
  };

  // Same categories the customer/merchant dashboards already group items into, plus a
  // "new category" escape hatch below for anything that doesn't fit yet.
  categories = ['Beverage', 'Bakery', 'Tiffin', 'Sweets', 'Snacks'];
  addingCategory:boolean=false;
  customCategory:string='';

  constructor(private http:HttpClient, private router:Router) { }

  ngOnInit() {
    if(sessionStorage.getItem('userData')==null) {
      this.router.navigate(['login']);
      return;
    }
  }

  url:string=null;
  message:string=null;
  success:string=null;
  saving:boolean=false;

  categoryIcon(category:string|null):string{
    const icons:{[key:string]:string} = {
      'Beverage': 'fa-coffee',
      'Bakery': 'fa-birthday-cake',
      'Tiffin': 'fa-cutlery',
      'Sweets': 'fa-heart',
      'Snacks': 'fa-fire',
    };
    return icons[category] || 'fa-th-large';
  }

  selectCategory(category:string):void{
    this.newFoodItems.category = category;
    this.addingCategory = false;
  }

  startCustomCategory():void{
    this.addingCategory = true;
    this.customCategory = '';
  }

  confirmCustomCategory():void{
    const name = this.customCategory.trim();
    if (!name) return;
    this.newFoodItems.category = name;
    this.addingCategory = false;
  }

  // Live preview data, so the merchant can see exactly what the item will look like on the
  // customer menu grid before submitting - reads straight off the form, no separate state.
  get previewImage():string{
    return this.imageDataUrl || this.newFoodItems.fileDataF || '';
  }

  get isReadyToPublish():boolean{
    return !!(this.newFoodItems.id && this.newFoodItems.id.length === 3
      && this.newFoodItems.name
      && this.newFoodItems.price != null && this.newFoodItems.price >= 0
      && this.newFoodItems.quantityAvailable != null && this.newFoodItems.quantityAvailable >= 0
      && this.newFoodItems.category
      && this.previewImage);
  }

  onSubmit():void{
    if (this.saving) return;
    this.message = null;
    this.success = null;

    const formData = new FormData();
    formData.append('newFoodItem',JSON.stringify(this.newFoodItems));

    // A file upload goes through /addNewItem (it requires one); a pasted image URL, with no
    // file selected, goes through /addNewItemUrl instead.
    if (this.selectedFile) {
      formData.append('file', this.selectedFile);
      this.url=`${environment.apiUrl}/addNewItem`;
    } else {
      this.url=`${environment.apiUrl}/addNewItemUrl`;
    }

    this.saving = true;
    this.http.post(this.url, formData)
      .subscribe(
        res=>
        {
          this.saving = false;
          this.success = "Item added";
          this.resetForm();
        },err=>{
          this.saving = false;
          this.message = typeof err.error === 'string' ? err.error : "Couldn't add the item. Please try again.";
        }
      )
  }

  resetForm():void{
    this.newFoodItems = { id:'', name:'', price:null, quantityAvailable:null, fileDataF:null, category:null };
    this.selectedFile = null;
    this.imageDataUrl = null;
    this.present = null;
  }

  selectedFile:any=null;
  imageDataUrl:string=null;

  onFileSelected(event) {
    const file = event.target.files && event.target.files[0];
    this.setFile(file);
  }

  onFileDropped(event:DragEvent) {
    event.preventDefault();
    this.dragOver = false;
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) this.setFile(file);
  }

  dragOver:boolean=false;

  onDragOver(event:DragEvent){
    event.preventDefault();
    this.dragOver = true;
  }

  onDragLeave(){
    this.dragOver = false;
  }

  private setFile(file:File){
    if (!file) return;
    this.selectedFile = file;
    const reader = new FileReader();
    reader.onload = () => { this.imageDataUrl = reader.result as string; };
    reader.readAsDataURL(file);
  }

  clearImage():void{
    this.selectedFile = null;
    this.imageDataUrl = null;
    this.newFoodItems.fileDataF = null;
  }

  present:boolean=null;
  checkingAvailability:boolean=false;

  checkAvailability() {
    if (!this.newFoodItems.id) return;
    this.checkingAvailability = true;
    this.http.post<boolean>(`${environment.apiUrl}/checkItemId`,this.newFoodItems.id).subscribe(
      res=>{
        this.checkingAvailability = false;
        this.present=res;
      },err=>{
        this.checkingAvailability = false;
        this.message = "Couldn't check that ID right now. Try again.";
      }
    )
  }

  clearLocal(){
    sessionStorage.clear();
  }
}

export interface foodItems {
  id: string;
  name:string;
  price:number;
  quantityAvailable:number;
  fileDataF:string;
  category:string;
}
